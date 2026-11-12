from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import user_data_scope, user_has_permission
from app.core.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from app.modules.auth.schemas import AuthUser
from app.modules.checkin.attachment_store import (
    _read_meta,
    assert_attachments_ready,
    resolve_attachment_path,
)
from app.modules.checkin.repository import CheckinRepository, _row_to_record
from app.modules.checkin.schemas import CheckinRecord, CheckinStats, CheckinType, CreateCheckinBody
from app.modules.users.repository import UsersRepository


class CheckinService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = CheckinRepository(db)

    def _assert_checkin_access(self, user: AuthUser) -> None:
        if not user_has_permission(user, "section:checkin"):
            raise PermissionDeniedError()

    def _can_view_team_scope(self, user: AuthUser) -> bool:
        if user_has_permission(user, "checkin:view_team"):
            return True
        return user_data_scope(user) != "own"

    async def _allowed_user_ids(self, user: AuthUser, scope: str) -> list[str] | None:
        if scope == "own":
            return [user.id]

        self._assert_checkin_access(user)
        if not self._can_view_team_scope(user):
            raise PermissionDeniedError()

        if user_data_scope(user) == "all":
            return None

        if user_data_scope(user) == "department":
            return await UsersRepository(self.db).get_department_peer_user_ids(user.id, user.department_names)

        raise PermissionDeniedError()

    async def assert_attachment_access(self, user: AuthUser, attachment_id: str) -> None:
        """打卡附件：能看该打卡记录的人可读；未入库的仅上传者 / all。"""
        self._assert_checkin_access(user)
        try:
            path = resolve_attachment_path(attachment_id)
        except ValidationError as exc:
            raise NotFoundError("附件不存在") from exc
        if not path.is_file():
            raise NotFoundError("附件不存在")

        owner_user_id = await self.repo.find_user_id_for_attachment(attachment_id)
        if not owner_user_id:
            meta = _read_meta(path)
            uploader = str(meta.get("uploadedBy") or "").strip()
            if user_data_scope(user) == "all":
                return
            if uploader and uploader == user.id:
                return
            raise PermissionDeniedError("无权访问该附件")

        if owner_user_id == user.id:
            return
        if user_data_scope(user) == "all":
            return
        if not self._can_view_team_scope(user):
            raise PermissionDeniedError("无权访问该附件")
        allowed = await self._allowed_user_ids(user, "team")
        if allowed is None or owner_user_id in allowed:
            return
        raise PermissionDeniedError("无权访问该附件")

    async def list_records(
        self,
        user: AuthUser,
        *,
        scope: str = "own",
        user_id: str | None = None,
        record_type: CheckinType | None = None,
        from_ts: int | None = None,
        to_ts: int | None = None,
    ) -> list[CheckinRecord]:
        self._assert_checkin_access(user)
        allowed = await self._allowed_user_ids(user, scope)

        if user_id:
            if allowed is not None and user_id not in allowed:
                raise PermissionDeniedError()
            filter_ids = [user_id]
        else:
            filter_ids = allowed

        rows = await self.repo.list_filtered(
            user_ids=filter_ids,
            record_type=record_type,
            from_ts=from_ts,
            to_ts=to_ts,
        )
        attachments_map = await self.repo.list_checkin_attachments([row.id for row in rows])
        return [
            _row_to_record(row, attachments_map.get(row.id))
            for row in rows
        ]

    async def get_active_visit_id(self, user: AuthUser) -> str | None:
        self._assert_checkin_access(user)
        return await self.repo.find_open_visit_id(user.id)

    async def get_stats(
        self,
        user: AuthUser,
        *,
        scope: str = "team",
        user_id: str | None = None,
        record_type: CheckinType | None = None,
        from_ts: int | None = None,
        to_ts: int | None = None,
    ) -> CheckinStats:
        self._assert_checkin_access(user)

        if scope == "own":
            if user_id and user_id != user.id:
                raise PermissionDeniedError()
            rows = await self.repo.list_filtered(
                user_ids=[user.id],
                record_type=record_type,
                from_ts=from_ts,
                to_ts=to_ts,
            )
            return await self.repo.compute_stats(rows)

        if user_data_scope(user) == "own" and not self._can_view_team_scope(user):
            raise PermissionDeniedError()

        allowed = await self._allowed_user_ids(user, "team")
        filter_ids = [user_id] if user_id else allowed
        if user_id and allowed is not None and user_id not in allowed:
            raise PermissionDeniedError()

        rows = await self.repo.list_filtered(
            user_ids=filter_ids,
            record_type=record_type,
            from_ts=from_ts,
            to_ts=to_ts,
        )
        return await self.repo.compute_stats(rows)

    async def create(self, user: AuthUser, body: CreateCheckinBody) -> CheckinRecord:
        self._assert_checkin_access(user)
        open_visit_id = await self.repo.find_open_visit_id(user.id)

        if body.type == "arrive":
            if open_visit_id:
                raise ValidationError("当前有未结束的拜访，请先结束打卡后再开始新的到达")
            if not body.attachment_ids:
                raise ValidationError("到达打卡需上传至少一张现场照片")
            assert_attachments_ready(body.attachment_ids, uploaded_by=user.id)
        elif body.type == "leave":
            if not body.visit_id:
                raise ValidationError("结束打卡需要有效的拜访 ID")
            if not open_visit_id:
                if await self.repo.has_record_type_for_visit(
                    user_id=user.id, visit_id=body.visit_id, record_type="leave"
                ):
                    raise ValidationError("该拜访已结束打卡")
                if not await self.repo.has_record_type_for_visit(
                    user_id=user.id, visit_id=body.visit_id, record_type="arrive"
                ):
                    raise ValidationError("未找到对应的到达打卡，请先到达打卡")
                raise ValidationError("没有进行中的拜访可结束，请刷新页面后重试")
            if body.visit_id != open_visit_id:
                raise ValidationError("结束打卡与当前进行中的拜访不一致，请刷新页面后重试")
            if body.attachment_ids:
                assert_attachments_ready(body.attachment_ids, uploaded_by=user.id)
        else:
            raise ValidationError("无效的打卡类型")

        row = await self.repo.create(
            user_id=user.id,
            user_name=user.name,
            department_names=user.department_names,
            visit_id=body.visit_id,
            record_type=body.type,
            timestamp=body.timestamp,
            beijing_time=body.beijing_time,
            latitude=body.latitude,
            longitude=body.longitude,
            accuracy=body.accuracy,
            address=body.address,
            province=body.province,
            city=body.city,
            district=body.district,
            attachment_ids=body.attachment_ids,
        )
        await self.db.commit()
        attachments_map = await self.repo.list_checkin_attachments([row.id])
        return _row_to_record(row, attachments_map.get(row.id))
