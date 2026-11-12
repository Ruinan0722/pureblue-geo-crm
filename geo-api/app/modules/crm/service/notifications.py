from __future__ import annotations

from app.modules.crm.service.base import (
    AuthUser,
    NotFoundError,
    NotificationCreateBody,
    NotificationResponse,
    PermissionDeniedError,
    UsersRepository,
    ValidationError,
    _china_today_iso,
    _doc,
    format_legacy_time,
    uuid4,
)


class NotificationMixin:
    def _notification_to_response(self, row) -> NotificationResponse:
            return NotificationResponse(
                id=row.id,
                target_name=row.target_name,
                actor=row.actor,
                message=row.message,
                href=row.href or "",
                created_at=format_legacy_time(row.created_at),
                read=bool(row.is_read),
            )

    async def _resolve_user_id_by_name(self, name: str) -> str | None:
            trimmed = (name or "").strip()
            if not trimmed:
                return None
            try:
                found = await UsersRepository(self.db).get_active_feishu_user_by_name(trimmed)
            except ValidationError:
                return None
            return found.id if found else None

    async def create_notifications(self, user: AuthUser, body: NotificationCreateBody) -> list[NotificationResponse]:
            if not body.items:
                raise ValidationError("通知列表不能为空")
            from app.modules.users.mention_scope import normalize_mention_scope

            scope = normalize_mention_scope(body.mention_scope)
            if body.mention_scope and not scope:
                raise ValidationError("mentionScope 无效")
            created: list[NotificationResponse] = []
            push_targets: list[tuple[str, str]] = []
            for item in body.items:
                target_name = (item.target_name or "").strip()
                message = (item.message or "").strip()
                if not target_name or not message:
                    continue
                target_user_id = await self._resolve_user_id_by_name(target_name)
                # @通知可发给飞书组织架构中的任意在职成员；姓名必须能唯一解析到
                # users 快照，避免给离职、未同步或重名成员生成无归属通知。
                if not target_user_id:
                    continue
                row = await self.repo.create_notification(
                    record_id=f"ntf-{uuid4().hex[:16]}",
                    target_name=target_name[:128],
                    target_user_id=target_user_id,
                    actor=user.name[:128],
                    actor_user_id=user.id,
                    message=message[:512],
                    href=(item.href or "")[:512],
                )
                created.append(self._notification_to_response(row))
                if target_user_id:
                    push_targets.append((target_user_id, target_name))
            if not created:
                raise ValidationError("没有可通知的在职组织成员")
            await self.db.commit()
            await self._push_unread_snapshots(push_targets)
            return created

    @staticmethod
    def follow_up_reminder_id(customer_id: str, today: str) -> str:
            """同一客户同一天只发一条跟进提醒（主键幂等）。"""
            day = today.replace("-", "")[:8]
            return f"ntf-fu-{customer_id}-{day}"[:64]

    @staticmethod
    def opportunity_follow_up_reminder_id(opportunity_id: str, today: str) -> str:
            """同一商机同一天只发一条跟进提醒（主键幂等）。"""
            day = today.replace("-", "")[:8]
            return f"ntf-fu-opp-{opportunity_id}-{day}"[:64]

    async def dispatch_follow_up_reminders(self, *, today: str | None = None) -> dict[str, int | str]:
            """
            为「下次计划跟进 = 今天」的客户 / 商机向销售负责人发系统通知。
            幂等：通知 id = ntf-fu-{customerId|opp-…}-{YYYYMMDD}，已存在则跳过。
            """
            day = (today or _china_today_iso()).strip()[:10]
            customer_rows = await self.repo.list_customers_due_follow_up(day)
            opportunity_rows = await self.repo.list_opportunities_due_follow_up(day)
            created = 0
            skipped = 0
            unresolved = 0
            push_targets: list[tuple[str, str]] = []
            users_repo = UsersRepository(self.db)

            async def _resolve_owner(owner_user_id: str | None, owner_name: str) -> tuple[str | None, str]:
                uid = (owner_user_id or "").strip() or None
                name = (owner_name or "").strip()
                if not uid and name:
                    try:
                        uid = await users_repo.resolve_user_id_by_owner_name(name)
                    except ValidationError:
                        uid = None
                if uid and not name:
                    user_row = await users_repo.get_by_id(uid)
                    name = (user_row.name if user_row else "") or ""
                return uid, name

            for row in customer_rows:
                doc = _doc(row)
                reminder_id = self.follow_up_reminder_id(row.id, day)
                if await self.repo.get_notification(reminder_id):
                    skipped += 1
                    continue

                owner_user_id, owner_name = await _resolve_owner(
                    row.owner_user_id,
                    str(doc.get("owner") or ""),
                )
                if not owner_user_id or not owner_name:
                    unresolved += 1
                    continue

                brand = str(doc.get("brandName") or "").strip()
                company = str(doc.get("companyName") or row.company_name or "").strip()
                label = brand or company or row.id
                message = f"提醒你：客户「{label}」今天计划跟进，请及时联系"

                await self.repo.create_notification(
                    record_id=reminder_id,
                    target_name=owner_name[:128],
                    target_user_id=owner_user_id,
                    actor="系统",
                    actor_user_id=None,
                    message=message[:512],
                    href=f"/customers/{row.id}"[:512],
                )
                created += 1
                push_targets.append((owner_user_id, owner_name))

            for row in opportunity_rows:
                doc = _doc(row)
                reminder_id = self.opportunity_follow_up_reminder_id(row.id, day)
                if await self.repo.get_notification(reminder_id):
                    skipped += 1
                    continue

                owner_user_id, owner_name = await _resolve_owner(
                    row.owner_user_id,
                    str(doc.get("owner") or ""),
                )
                if not owner_user_id or not owner_name:
                    unresolved += 1
                    continue

                label = str(doc.get("name") or "").strip() or row.id
                message = f"提醒你：商机「{label}」今天计划跟进，请及时推进"

                await self.repo.create_notification(
                    record_id=reminder_id,
                    target_name=owner_name[:128],
                    target_user_id=owner_user_id,
                    actor="系统",
                    actor_user_id=None,
                    message=message[:512],
                    href=f"/opportunities/{row.id}"[:512],
                )
                created += 1
                push_targets.append((owner_user_id, owner_name))

            if created:
                await self.db.commit()
                await self._push_unread_snapshots(push_targets)
            return {
                "today": day,
                "due": len(customer_rows) + len(opportunity_rows),
                "customers_due": len(customer_rows),
                "opportunities_due": len(opportunity_rows),
                "created": created,
                "skipped": skipped,
                "unresolved": unresolved,
            }

    async def list_notifications(self, user: AuthUser, *, limit: int = 100) -> list[NotificationResponse]:
            rows = await self.repo.list_notifications_for_user(
                user_id=user.id,
                user_name=user.name,
                limit=limit,
            )
            return [self._notification_to_response(row) for row in rows]

    async def unread_snapshot(self, *, user_id: str, user_name: str) -> tuple[int, str | None]:
            return await self.repo.count_unread_notifications(user_id=user_id, user_name=user_name)

    async def _push_unread_snapshots(self, targets: list[tuple[str, str]]) -> None:
            if not targets:
                return
            from app.modules.crm.notification_cache import set_and_publish_unread
            from app.modules.crm.notification_hub import notification_hub

            seen: set[str] = set()
            for uid, uname in targets:
                if not uid or uid in seen:
                    continue
                seen.add(uid)
                unread, latest_id = await self.repo.count_unread_notifications(user_id=uid, user_name=uname)
                published = await set_and_publish_unread(uid, unread, latest_id)
                # Pub/Sub 成功时由各 worker 订阅推送（含本进程）；失败再本地 hub 兜底，避免双推
                if not published:
                    await notification_hub.publish(
                        uid,
                        {
                            "type": "unread",
                            "unreadCount": unread,
                            "latestId": latest_id or "",
                        },
                    )

    async def mark_notification_read(self, user: AuthUser, notification_id: str) -> NotificationResponse:
            row = await self.repo.get_notification(notification_id)
            if not row:
                raise NotFoundError("通知不存在")
            owned = row.target_user_id == user.id or row.target_name == user.name
            if not owned:
                raise PermissionDeniedError("无权操作该通知")
            await self.repo.mark_notifications_read(
                user_id=user.id,
                user_name=user.name,
                notification_id=notification_id,
            )
            await self.db.commit()
            refreshed = await self.repo.get_notification(notification_id)
            assert refreshed is not None
            await self._push_unread_snapshots([(user.id, user.name)])
            return self._notification_to_response(refreshed)

    async def mark_all_notifications_read(self, user: AuthUser) -> int:
            count = await self.repo.mark_notifications_read(user_id=user.id, user_name=user.name)
            await self.db.commit()
            await self._push_unread_snapshots([(user.id, user.name)])
            return count
