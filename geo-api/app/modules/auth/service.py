from __future__ import annotations

import uuid

from fastapi import Response
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.cookies import (
    clear_access_token_cookie,
    clear_oauth_state_cookie,
    set_access_token_cookie,
)
from app.core.exceptions import ValidationError
from app.core.feishu.oauth import (
    assert_tenant_allowed,
    exchange_browser_oauth_code,
    get_feishu_authorize_url,
    is_feishu_oauth_configured,
)
from app.core.jwt import create_access_token, decode_access_token
from app.core.time_utils import utc_now
from app.models import User
from app.modules.auth.repository import AuthRepository
from app.modules.auth.schemas import AuthUser, FeishuTokenResponse, MeResponse
from app.modules.users.repository import UsersRepository
from app.modules.users.role_resolver import is_super_admin_open_id, resolve_staff_role_for_login


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = AuthRepository(db)
        self.users_repo = UsersRepository(db)
        self.settings = get_settings()

    @staticmethod
    def _cookie_secure(portal_url: str) -> bool:
        return portal_url.startswith("https://")

    async def get_me(self, access_token: str | None) -> MeResponse:
        user = await self._resolve_user_from_token(access_token)
        return MeResponse(
            user=user,
            feishu_configured=is_feishu_oauth_configured(),
        )

    async def dev_login(self, *, name: str, role: str) -> tuple[str, int]:
        """开发/Staging 测试身份登录：写入 dev 用户（不落飞书）并签发 JWT。

        调用方必须先经过 geo_features 的生产/开关校验。
        """
        from sqlalchemy import select

        from app.models import User

        safe_name = (name or "").strip() or "开发测试"
        # 优先以同名真实成员身份登录（数据/权限按真实归属，便于按真实负责人测试）；
        # 仅匹配 ou_ 真实用户，dev 占位用户不在此列。
        real = await self._find_real_user_by_name(safe_name)
        if real is not None:
            return create_access_token(user_id=real.id, role=real.role)

        open_id = f"dev_{safe_name}"
        row = (
            await self.db.execute(select(User).where(User.feishu_open_id == open_id))
        ).scalar_one_or_none()
        now = utc_now()
        if row is None:
            row = User(
                id=f"u-dev-{uuid.uuid4().hex[:12]}",
                feishu_open_id=open_id,
                name=safe_name,
                role=role,
                role_source="dev",
                role_locked=True,
                department_names=[],
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)
        else:
            row.name = safe_name
            row.role = role
            row.role_source = "dev"
            row.updated_at = now
        await self.db.flush()
        await self.db.commit()
        return create_access_token(user_id=row.id, role=row.role)

    async def _find_real_user_by_name(self, name: str) -> User | None:
        """按姓名找真实成员（feishu_open_id 以 ou_ 开头、在职）；同名优先真实用户。"""
        from sqlalchemy import select

        from app.models import User

        rows = (
            await self.db.execute(
                select(User)
                .where(User.name == name, User.employment_status == "active")
                .order_by(User.feishu_open_id)
            )
        ).scalars().all()
        for row in rows:
            if str(row.feishu_open_id or "").startswith("ou_"):
                return row
        return None

    async def _resolve_user_from_token(self, access_token: str | None) -> AuthUser | None:
        if not access_token:
            return None
        try:
            payload = decode_access_token(access_token)
            return await self.repo.get_auth_user_by_id(payload.user_id)
        except Exception:  # noqa: BLE001  有意兜底（清理/回退/探测不应中断主流程）
            return None

    def start_feishu_login(self, redirect_uri: str | None = None) -> tuple[str, str]:
        if not is_feishu_oauth_configured():
            raise ValidationError(
                "飞书应用未配置：请设置 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_REDIRECT_URI"
            )
        state = str(uuid.uuid4())
        return get_feishu_authorize_url(state, redirect_uri=redirect_uri), state

    async def _login_with_feishu_code(self, code: str, redirect_uri: str | None = None) -> tuple[User, str, int]:
        if not code:
            raise ValidationError("missing_code")

        feishu_user = await exchange_browser_oauth_code(code, redirect_uri=redirect_uri)
        assert_tenant_allowed(feishu_user.tenant_key)

        user = await self._resolve_login_user(feishu_user.open_id, feishu_user.name, feishu_user.avatar_url)

        await self.db.commit()

        access_token, expires_in = create_access_token(user_id=user.id, role=user.role)
        return user, access_token, expires_in

    async def _resolve_login_user(
        self,
        feishu_open_id: str,
        oauth_name: str,
        oauth_avatar: str | None,
    ) -> User:
        existing = await self.users_repo.get_by_feishu_open_id(feishu_open_id)

        if existing is not None and existing.is_resigned:
            raise ValidationError("您的账号已离职，无法登录系统")

        # 尚未绑定角色：无任何角色绑定则拒绝进入（不是离职；需管理员开通）
        if existing is not None and not is_super_admin_open_id(feishu_open_id):
            role_n = (
                await self.db.execute(
                    text(
                        "SELECT COUNT(*) FROM user_role_assignments WHERE user_id = :uid"
                    ),
                    {"uid": existing.id},
                )
            ).scalar_one()
            if int(role_n or 0) == 0:
                raise ValidationError("您的账号尚未开通系统访问权限，请联系管理员")

        # 唯一超管：任意登录路径都纠正为 super_admin（含 skip_department / locked / feishu）
        if is_super_admin_open_id(feishu_open_id):
            if existing is None and not self.settings.feishu_skip_department_check:
                raise ValidationError("您的账号尚未同步到系统，请稍后重试或联系管理员")
            return await self.users_repo.resolve_and_upsert(
                feishu_open_id=feishu_open_id,
                name=oauth_name or (existing.name if existing else ""),
                avatar_url=oauth_avatar
                if oauth_avatar is not None
                else (existing.avatar_url if existing else None),
                department_names=(
                    existing.department_names
                    if existing is not None and isinstance(existing.department_names, list)
                    else []
                ),
            )

        if self.settings.feishu_skip_department_check:
            if existing is None:
                return await self.users_repo.resolve_and_upsert(
                    feishu_open_id=feishu_open_id,
                    name=oauth_name,
                    avatar_url=oauth_avatar,
                    department_names=[],
                )
            return await self._touch_oauth_profile(existing, oauth_name, oauth_avatar)

        if existing is None:
            raise ValidationError("您的账号尚未同步到系统，请稍后重试或联系管理员")

        if existing.role_locked or existing.role_source == "manual":
            return await self._touch_oauth_profile(existing, oauth_name, oauth_avatar)

        department_names = (
            existing.department_names if isinstance(existing.department_names, list) else []
        )
        try:
            await resolve_staff_role_for_login(
                self.db,
                feishu_open_id=feishu_open_id,
                department_names=department_names,
            )
        except RuntimeError as exc:
            if self.settings.app_env == "production":
                raise ValidationError("您的部门暂无系统访问权限，请联系管理员") from exc
            raise ValidationError(str(exc)) from exc

        return await self._touch_oauth_profile(existing, oauth_name, oauth_avatar)

    async def _touch_oauth_profile(
        self,
        user: User,
        oauth_name: str,
        oauth_avatar: str | None,
    ) -> User:
        name = (oauth_name or user.name).strip() or user.name
        avatar = oauth_avatar if oauth_avatar is not None else user.avatar_url
        if user.name == name and user.avatar_url == avatar:
            return user

        now = utc_now()
        await self.db.execute(
            update(User)
            .where(User.id == user.id)
            .values(name=name, avatar_url=avatar, updated_at=now)
        )
        await self.db.flush()
        refreshed = await self.users_repo.get_by_id(user.id)
        assert refreshed is not None
        return refreshed

    async def complete_feishu_login(
        self,
        *,
        code: str,
        state: str,
        saved_state: str | None,
        response: Response,
        portal_url: str | None = None,
        redirect_uri: str | None = None,
    ) -> str:
        if not state or state != saved_state:
            raise ValidationError("invalid_state")

        _user, access_token, expires_in = await self._login_with_feishu_code(code, redirect_uri=redirect_uri)
        base = (portal_url or self.settings.admin_portal_url).rstrip("/")
        secure = self._cookie_secure(base)
        set_access_token_cookie(response, access_token, expires_in, secure=secure)
        clear_oauth_state_cookie(response, secure=secure)
        # 按权限落到首个可访问模块（/go → 通常为首页工作台；海外运营含 section:home）
        return f"{base}/go"

    async def exchange_feishu_code(self, code: str) -> FeishuTokenResponse:
        """移动端 / 多端：用飞书 code 换取 JWT（JSON 响应）。"""
        user, access_token, expires_in = await self._login_with_feishu_code(code)
        auth_user = await self.repo.get_auth_user_by_id(user.id)
        assert auth_user is not None
        return FeishuTokenResponse(
            access_token=access_token,
            token_type="Bearer",
            expires_in=expires_in,
            user=auth_user,
        )

    async def logout(self, response: Response, portal_url: str | None = None) -> None:
        base = (portal_url or self.settings.admin_portal_url).rstrip("/")
        clear_access_token_cookie(response, secure=self._cookie_secure(base))

    def login_error_redirect(self, message: str, portal_url: str | None = None) -> str:
        base = (portal_url or self.settings.admin_portal_url).rstrip("/")
        return f"{base}/login?error={message}"
