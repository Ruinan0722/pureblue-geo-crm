from __future__ import annotations

from pydantic import Field

from app.modules.auth.schemas import CamelModel


class SalesColleague(CamelModel):
    id: str
    name: str
    job_title: str | None = None
    department_names: list[str] = Field(default_factory=list)


class SalesColleaguesResponse(CamelModel):
    colleagues: list[SalesColleague] = Field(default_factory=list)
    department_label: str = "销售部"
    source: str | None = None


class DirectoryMember(CamelModel):
    id: str
    name: str
    role: str = ""
    department_names: list[str] = Field(default_factory=list)


class DirectoryResponse(CamelModel):
    """CRM/@ 通讯录：来自 MySQL users 快照（非飞书实时）。设置页选人走 admin 飞书 API。"""

    members: list[DirectoryMember] = Field(default_factory=list)
    source: str = "mysql_users"


class DirectManagerResponse(CamelModel):
    """按姓名查询员工在飞书通讯录中的直属上级。"""

    name: str
    manager_name: str = ""
    manager_user_id: str | None = None
    source: str | None = None
    message: str = ""
