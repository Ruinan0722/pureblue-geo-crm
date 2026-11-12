from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RoleOut(BaseModel):
    id: str
    code: str
    name: str
    description: str = ""
    dataScope: str = "own"
    isSystem: bool = False
    sortOrder: int = 0
    permissions: list[str] = Field(default_factory=list)


class PermissionOut(BaseModel):
    code: str
    name: str
    module: str
    sortOrder: int = 0


class DepartmentRuleOut(BaseModel):
    departmentName: str
    roleCode: str
    sortOrder: int = 0


class UserRoleOut(BaseModel):
    userId: str
    roleId: str
    roleCode: str
    isPrimary: bool = False


class PermissionOverrideOut(BaseModel):
    userId: str
    permissionCode: str
    granted: bool


class AdminUserOut(BaseModel):
    id: str
    feishuOpenId: str
    name: str
    avatarUrl: str | None = None
    role: str
    roleSource: str = "feishu"
    roleLocked: bool = False
    employmentStatus: str = "active"
    leftAt: str | None = None
    dataScopeOverride: str | None = None
    departmentNames: list[str] = Field(default_factory=list)
    manualDepartmentOpenId: str | None = None
    manualDepartmentName: str | None = None
    manualDepartmentNote: str | None = None
    manualDepartmentLeader: bool = False
    feishuLedDepartmentIds: list[Any] = Field(default_factory=list)
    roles: list[RoleOut] = Field(default_factory=list)
    permissionOverrides: list[PermissionOverrideOut] = Field(default_factory=list)
    effectivePermissions: list[str] = Field(default_factory=list)
    effectiveDataScope: str = "own"


class RolesUpdateIn(BaseModel):
    roleCodes: list[str]
    primaryRoleCode: str | None = None


class OverridesUpdateIn(BaseModel):
    overrides: list[PermissionOverrideOut] = Field(default_factory=list)


class LockUpdateIn(BaseModel):
    locked: bool = False


class DataScopeUpdateIn(BaseModel):
    dataScope: str | None = None


class RoleUpdateIn(BaseModel):
    name: str | None = None
    description: str | None = None
    dataScope: str | None = None
    permissions: list[str] | None = None


class RoleCreateIn(BaseModel):
    code: str
    name: str
    description: str = ""
    dataScope: str = "own"
    permissions: list[str] = Field(default_factory=list)


class GrantIn(BaseModel):
    feishuOpenId: str
    name: str
    avatarUrl: str | None = None
    departmentNames: list[str] = Field(default_factory=list)
    roleCodes: list[str]
    primaryRoleCode: str | None = None


class DirectoryUpsertIn(BaseModel):
    feishuOpenId: str
    name: str
    manualDepartmentOpenId: str | None = None
    manualDepartmentName: str | None = None
    manualDepartmentNote: str | None = None
    manualDepartmentLeader: bool = False


class UserDirectoryUpdateIn(BaseModel):
    manualDepartmentOpenId: str | None = None
    manualDepartmentName: str | None = None
    manualDepartmentNote: str | None = None
    manualDepartmentLeader: bool = False


class DirectoryMembersIn(BaseModel):
    departmentId: str
    subtree: bool = False


class DepartmentChildrenIn(BaseModel):
    parentId: str


class ResolveDepartmentsIn(BaseModel):
    openIds: list[str] = Field(default_factory=list)


class MetaOut(BaseModel):
    dataScopeLabels: dict[str, str] = Field(default_factory=dict)
    autoLoginRules: list[dict[str, str]] = Field(default_factory=list)
    superAdminFeishuOpenId: str | None = None
