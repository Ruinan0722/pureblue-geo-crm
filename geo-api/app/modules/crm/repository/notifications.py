from __future__ import annotations

from app.models.crm import CrmSalesCoverage
from app.modules.crm.repository.base import (
    CrmCustomer,
    CrmNotification,
    CrmOpportunity,
    Sequence,
    _now,
    func,
    or_,
    select,
)


class NotificationsRepositoryMixin:
    async def create_notification(
            self,
            *,
            record_id: str,
            target_name: str,
            target_user_id: str | None,
            actor: str,
            actor_user_id: str | None,
            message: str,
            href: str,
        ) -> CrmNotification:
            row = CrmNotification(
                id=record_id,
                target_name=target_name,
                target_user_id=target_user_id,
                actor=actor,
                actor_user_id=actor_user_id,
                message=message,
                href=href,
                is_read=False,
                created_at=_now(),
            )
            self.db.add(row)
            await self.db.flush()
            return row

    async def list_notifications_for_user(
            self,
            *,
            user_id: str,
            user_name: str,
            limit: int = 100,
        ) -> Sequence[CrmNotification]:
            limit = max(1, min(int(limit or 100), 200))
            clauses = self._notification_ownership_clauses(user_id=user_id, user_name=user_name)
            stmt = (
                select(CrmNotification)
                .where(or_(*clauses))
                .order_by(CrmNotification.created_at.desc())
                .limit(limit)
            )
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def count_unread_notifications(
            self,
            *,
            user_id: str,
            user_name: str,
        ) -> tuple[int, str | None]:
            """返回 (未读数, 最新一条通知 id)。"""
            from sqlalchemy import func

            clauses = self._notification_ownership_clauses(user_id=user_id, user_name=user_name)
            owned = or_(*clauses)
            unread_stmt = select(func.count()).select_from(CrmNotification).where(
                owned,
                CrmNotification.is_read.is_(False),
            )
            unread = int((await self.db.execute(unread_stmt)).scalar_one() or 0)
            latest_stmt = (
                select(CrmNotification.id)
                .where(owned)
                .order_by(CrmNotification.created_at.desc())
                .limit(1)
            )
            latest_id = (await self.db.execute(latest_stmt)).scalar_one_or_none()
            return unread, str(latest_id) if latest_id else None

    async def get_notification(self, notification_id: str) -> CrmNotification | None:
            return await self.db.get(CrmNotification, notification_id)

    async def list_customers_due_follow_up(self, today: str) -> Sequence[CrmCustomer]:
            """下次计划跟进日为 today（YYYY-MM-DD）且未流失的客户。"""
            day = (today or "").strip()[:10]
            if len(day) != 10:
                return []
            next_follow = func.left(CrmSalesCoverage.next_follow_at, 10)
            stmt = (
                select(CrmCustomer)
                .where(
                    CrmCustomer.status.notin_(["stopped", "lost"]),
                    select(CrmSalesCoverage.id)
                    .where(
                        CrmSalesCoverage.customer_id == CrmCustomer.id,
                        next_follow == day,
                    )
                    .exists(),
                )
                .order_by(CrmCustomer.updated_at.desc())
            )
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def list_opportunities_due_follow_up(self, today: str) -> Sequence[CrmOpportunity]:
            """下次计划跟进日为 today 且未赢单/输单的商机。"""
            day = (today or "").strip()[:10]
            if len(day) != 10:
                return []
            next_follow = func.left(CrmOpportunity.next_follow_at, 10)
            stmt = (
                select(CrmOpportunity)
                .where(
                    next_follow == day,
                    CrmOpportunity.stage.notin_(["won", "lost"]),
                )
                .order_by(CrmOpportunity.updated_at.desc())
            )
            result = await self.db.execute(stmt)
            return result.scalars().all()

    async def mark_notifications_read(
            self,
            *,
            user_id: str,
            user_name: str,
            notification_id: str | None = None,
        ) -> int:
            name = (user_name or "").strip()
            ownership = [CrmNotification.target_user_id == user_id]
            if name:
                ownership.append(CrmNotification.target_name == name)
            stmt = select(CrmNotification).where(or_(*ownership), CrmNotification.is_read.is_(False))
            if notification_id:
                stmt = stmt.where(CrmNotification.id == notification_id)
            result = await self.db.execute(stmt)
            rows = list(result.scalars().all())
            for row in rows:
                row.is_read = True
            if rows:
                await self.db.flush()
            return len(rows)
