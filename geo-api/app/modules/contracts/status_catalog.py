"""CRM 状态机与业务常量的唯一权威源（codes + labels + tones）。

本文件是前后端共享状态机/常量的**唯一定义处**：

- 前端 `geo-admin/modules/crm/lib/status-catalog.generated.ts` 由
  `geo-api/scripts/gen_frontend_status_catalog.py` 自动生成并提交，禁止手写或手改；
- 后端展示/审计文案从本文件派生（`app/modules/crm/service/base.py`），
  避免后端内部出现第二份 label 定义。

改动任何状态码、中文 label、tone、description 或来源清单后，必须重跑生成器并提交生成产物：

    python3 geo-api/scripts/gen_frontend_status_catalog.py

并运行强制校验（再生成 diff 必须为 0）：

    cd geo-api && .venv/bin/python -m pytest tests/test_status_catalog_generated_up_to_date.py -q
"""

from __future__ import annotations

# ============================================================
# 需求状态
# 与 `app/modules/requests/schemas.py` 的 RequestStatus Literal 一一对应，
# 由 tests/test_request_status_contract_parity.py 强制一致。
# reviewing/approved/rejected/supplement/closed 为历史遗留兼容值
# （仅保证渲染不崩，不进入需求管理筛选/动作）。
# ============================================================
REQUEST_STATUS_META: dict[str, dict[str, str]] = {
    "draft": {
        "label": "保存草稿",
        "description": "客户尚未正式提交",
        "tone": "muted",
    },
    "submitted": {
        "label": "客户已提交",
        "description": "客户已通过邀请提交，等待销售确认收到",
        "tone": "info",
    },
    "supplement": {
        "label": "待补充",
        "description": "历史遗留状态：当前信息不完整，需要客户补充（不在需求管理中使用）",
        "tone": "warning",
    },
    "pending_review": {
        "label": "待销售确认",
        "description": "信息基本完整，等待销售确认需求",
        "tone": "warning",
    },
    "confirmed": {
        "label": "已确认",
        "description": "需求内容已经销售确认，可独立完成处理",
        "tone": "success",
    },
    "in_project": {
        "label": "已完成",
        "description": "需求处理已完成",
        "tone": "success",
    },
    "closed": {
        "label": "已关闭",
        "description": "历史遗留状态：需求取消或不再继续跟进（不在需求管理中使用）",
        "tone": "neutral",
    },
    "reviewing": {
        "label": "审核中",
        "description": "历史遗留状态：需求审核中",
        "tone": "warning",
    },
    "approved": {
        "label": "已确认",
        "description": "历史遗留状态：需求已确认",
        "tone": "success",
    },
    "rejected": {
        "label": "已拒绝",
        "description": "历史遗留状态：需求已拒绝",
        "tone": "neutral",
    },
}
REQUEST_LEGACY_CODES: frozenset[str] = frozenset(
    {"reviewing", "approved", "rejected", "supplement", "closed"}
)

# 需求独立状态流转（按钮文案 + 下一状态）
REQUEST_STATUS_ACTIONS: dict[str, dict[str, str]] = {
    "submitted": {"label": "确认收到", "next": "pending_review"},
    "pending_review": {"label": "确认需求", "next": "confirmed"},
    "confirmed": {"label": "完成需求", "next": "in_project"},
}

# ============================================================
# 需求/商机/合同/项目业务归属（GEO 来源）
# feishuSource 为空表示无飞书来源（manual）；codePrefix 为空表示无编号前缀。
# ============================================================
REQUEST_GEO_SOURCES: dict[str, dict[str, str]] = {
    "domestic": {
        "label": "国内 GEO",
        "shortLabel": "国内",
        "feishuSource": "国内GEO需求",
        "codePrefix": "GEO-CN",
        "tone": "border-sky-200 bg-sky-50 text-sky-800",
    },
    "overseas": {
        "label": "海外 GEO",
        "shortLabel": "海外",
        "feishuSource": "海外GEO需求",
        "codePrefix": "GEO-OV",
        "tone": "border-violet-200 bg-violet-50 text-violet-800",
    },
    "mestbo": {
        "label": "麦思博 GEO",
        "shortLabel": "麦思博",
        "feishuSource": "麦思博GEO需求",
        "codePrefix": "GEO-MS",
        "tone": "border-amber-200 bg-amber-50 text-amber-900",
    },
    "manual": {
        "label": "系统录入",
        "shortLabel": "系统",
        "feishuSource": "",
        "codePrefix": "",
        "tone": "border-border bg-muted/40 text-muted-foreground",
    },
}

# ============================================================
# 商机阶段
# 9 个正阶段（与飞书 1:1，另含系统默认 contact）+ demand/solution/quote 旧合并兼容值。
# ============================================================
OPP_STAGE_ORDER: list[str] = [
    "contact",
    "demand_research",
    "demand_diagnosis",
    "solution_confirm",
    "business_negotiation",
    "bidding",
    "signing",
    "won",
    "lost",
]
OPP_STAGE_META: dict[str, dict[str, str]] = {
    "contact": {"label": "初步接触", "tone": "muted"},
    "demand_research": {"label": "需求调研", "tone": "info"},
    "demand_diagnosis": {"label": "需求诊断", "tone": "info"},
    "solution_confirm": {"label": "方案确认", "tone": "info"},
    "business_negotiation": {"label": "商务谈判", "tone": "warning"},
    "bidding": {"label": "招投标阶段", "tone": "warning"},
    "signing": {"label": "签署中", "tone": "warning"},
    "won": {"label": "已签订", "tone": "success"},
    "lost": {"label": "输单", "tone": "neutral"},
    # 旧合并值兼容
    "demand": {"label": "需求诊断", "tone": "info"},
    "solution": {"label": "方案确认", "tone": "info"},
    "quote": {"label": "商务谈判", "tone": "warning"},
}
OPP_LEGACY_CODES: frozenset[str] = frozenset({"demand", "solution", "quote"})

# ============================================================
# 合同状态
# 与飞书合同状态 1:1；void 仅保留系统作废兼容（非飞书值）。
# ============================================================
CONTRACT_STATUS_ORDER: list[str] = [
    "pending",
    "signed",
    "terminated",
    "closed",
    "void",
]
CONTRACT_STATUS_META: dict[str, dict[str, str]] = {
    "pending": {"label": "待签订", "tone": "muted"},
    "signed": {"label": "已签订", "tone": "success"},
    "terminated": {"label": "签订后终止", "tone": "danger"},
    "closed": {"label": "已关闭", "tone": "neutral"},
    "void": {"label": "已作废", "tone": "danger"},
}
CONTRACT_LEGACY_CODES: frozenset[str] = frozenset({"void"})

# ============================================================
# 合同遗留 projectStatus（签约侧遗留状态，不与 Project.stage 双写）
# ============================================================
CONTRACT_PROJECT_STATUS_ORDER: list[str] = [
    "not_started",
    "ongoing",
    "completed",
    "closed",
]
CONTRACT_PROJECT_STATUS_META: dict[str, dict[str, str]] = {
    "not_started": {"label": "未开始", "tone": "muted"},
    "ongoing": {"label": "进行中", "tone": "info"},
    "completed": {"label": "已完成", "tone": "success"},
    "closed": {"label": "已关闭", "tone": "neutral"},
}
CONTRACT_PROJECT_LEGACY_CODES: frozenset[str] = frozenset()

# ============================================================
# 交付项目阶段（Project.stage，交付执行的权威阶段）
# ============================================================
PROJECT_STAGE_ORDER: list[str] = [
    "pending_start",
    "active",
    "completed",
    "paused",
]
PROJECT_STAGE_META: dict[str, dict[str, str]] = {
    "pending_start": {"label": "待启动", "tone": "muted"},
    "active": {"label": "执行中", "tone": "info"},
    "completed": {"label": "已完结", "tone": "success"},
    # 沿用 paused 存量码，产品语义统一为“已延期”，避免线上数据迁移风险。
    "paused": {"label": "已延期", "tone": "danger"},
}
PROJECT_STAGE_LEGACY_CODES: frozenset[str] = frozenset()

# ============================================================
# 交付项目健康度
# ============================================================
PROJECT_HEALTH_ORDER: list[str] = ["healthy", "watch", "unhealthy"]
PROJECT_HEALTH_META: dict[str, dict[str, str]] = {
    "healthy": {"label": "健康", "tone": "success"},
    "watch": {"label": "一般", "tone": "warning"},
    "unhealthy": {"label": "不健康", "tone": "danger"},
}
PROJECT_HEALTH_LEGACY_CODES: frozenset[str] = frozenset()

# ============================================================
# 交付项目风险等级
# ============================================================
PROJECT_RISK_ORDER: list[str] = ["low", "medium", "high"]
PROJECT_RISK_META: dict[str, dict[str, str]] = {
    "low": {"label": "低", "tone": "success"},
    "medium": {"label": "中", "tone": "warning"},
    "high": {"label": "高", "tone": "danger"},
}
PROJECT_RISK_LEGACY_CODES: frozenset[str] = frozenset()

# ============================================================
# 交付项目记录类型（跟进记录 kind；仅 label，无 tone）
# ============================================================
PROJECT_NOTE_KIND_ORDER: list[str] = [
    "weekly",
    "communication",
    "execution",
    "risk",
    "next_step",
    "other",
]
PROJECT_NOTE_KIND_META: dict[str, str] = {
    "weekly": "周报",
    "communication": "客户沟通",
    "execution": "执行进展",
    "risk": "风险记录",
    "next_step": "下一步计划",
    "other": "其他",
}

# ============================================================
# 客户状态
# 5 个正状态；potential/following/lost 为旧值兼容展示（读取时请 normalizeCustomerStatus）。
# ============================================================
CUSTOMER_STATUS_ORDER: list[str] = [
    "awaiting_contact",
    "connected",
    "opportunity_following",
    "cooperating",
    "stopped",
]
CUSTOMER_STATUS_META: dict[str, dict[str, str]] = {
    "awaiting_contact": {"label": "待建联", "tone": "muted"},
    "connected": {"label": "已建联", "tone": "info"},
    "opportunity_following": {"label": "商机跟进", "tone": "warning"},
    "cooperating": {"label": "已合作", "tone": "success"},
    "stopped": {"label": "停止跟进", "tone": "neutral"},
    # 旧值兼容展示
    "potential": {"label": "待建联", "tone": "muted"},
    "following": {"label": "已建联", "tone": "info"},
    "lost": {"label": "停止跟进", "tone": "neutral"},
}
CUSTOMER_LEGACY_CODES: frozenset[str] = frozenset({"potential", "following", "lost"})

# ============================================================
# 线索状态
# ============================================================
LEAD_STATUS_META: dict[str, dict[str, str]] = {
    "untouched": {"label": "未触达", "tone": "muted"},
    "touched": {"label": "已触达", "tone": "info"},
    "converted": {"label": "已转客户", "tone": "success"},
    "invalid": {"label": "无效线索", "tone": "neutral"},
}

# 线索等级（与飞书「线索等级」1:1，含代理/海外，不合并到 A–D）
LEAD_LEVEL_ORDER: list[str] = ["A", "B", "C", "D", "代理", "海外"]
LEAD_LEVEL_META: dict[str, str] = {
    "A": "A 级",
    "B": "B 级",
    "C": "C 级",
    "D": "D 级",
    "代理": "代理",
    "海外": "海外",
}

# ============================================================
# 跟进状态（与飞书「需要跟进 / 无需跟进」对齐；converted 为系统结案）
# ============================================================
FOLLOW_STATE_META: dict[str, dict[str, str]] = {
    "need": {"label": "需要跟进"},
    "no_need": {"label": "无需跟进"},
    "converted": {"label": "已转为客户"},
}

# ============================================================
# 跟进方式（线上沟通 / 线下拜访）
# ============================================================
FOLLOW_TYPE_OPTIONS: list[dict[str, str]] = [
    {"value": "online", "label": "线上沟通"},
    {"value": "offline", "label": "线下拜访"},
]

# ============================================================
# 线索一级来源（12 个）
# ============================================================
LEAD_SOURCES: list[str] = [
    "渠道资料单",
    "渠道伙伴",
    "机构引荐",
    "线上投放",
    "三方会议",
    "自办会议",
    "官网注册",
    "热线电话",
    "内容营销",
    "数据采买",
    "名单外呼",
    "自拓",
    "其他来源",
]

# 机构引荐 · 二级（可后续增补）
LEAD_SOURCE_INSTITUTIONS: list[str] = ["ToBCGO"]

# 内容营销 · 二级（渠道识别）
LEAD_SOURCE_CONTENT_CHANNELS: list[str] = ["小红书", "公众号", "抖音", "视频号"]

# 官网注册 · 二级（官网首页 / Mark / 36氪入口）
LEAD_SOURCE_WEBSITE_ENTRIES: list[str] = ["官网首页", "Mark", "36氪"]

# 渠道管理：选项值与渠道 pipeline 的唯一权威源。
CHANNEL_TYPES: list[str] = [
    "广告代理", "个人", "媒体", "数字营销与SEO/GEO", "SaaS/营销科技经销商", "行业协会与商会",
]
CHANNEL_LEVELS: list[str] = [
    "重点合作", "继续跟进", "一般合作", "暂不考虑", "生态伙伴", "黑名单", "Mark合作",
]
CHANNEL_AGENCY_TYPES: list[str] = ["服务", "产品"]
CHANNEL_OPPORTUNITY_STAGES: list[str] = ["需求确认", "商务沟通", "签署中", "赢单"]
CHANNEL_CONTRACT_STATUSES: list[str] = ["否", "是", "准备签约", "走入库流程了"]
CHANNEL_REGIONS: dict[str, list[str]] = {
    "华北区": ["北京", "黑龙江", "吉林", "辽宁", "内蒙古", "天津", "河北", "山东", "山西", "陕西"],
    "华南区": ["广东", "广西壮族自治区", "海南", "香港特别行政区", "澳门特别行政区", "贵州", "四川", "湖南", "湖北"],
    "华东区": ["江西", "福建", "安徽", "浙江", "江苏", "上海"],
}

# 会议类一级来源（三方会议/自办会议共用「会议二级」交互）
MEETING_PRIMARY_SOURCES: list[str] = ["三方会议", "自办会议"]

# 历史写法 → 标准一级来源（导入/筛选兼容；前后端共用同一映射）
LEGACY_LEAD_SOURCE_MAP: dict[str, str] = {
    "机构推荐": "机构引荐",
    "线下会议": "自办会议",
    "官网": "官网注册",
    "官网首页": "官网注册",
    "landing page": "官网注册",
    "Landing page": "官网注册",
    "Landing Page": "官网注册",
    "36Kr": "官网注册",
    "36kr": "官网注册",
    "36氪": "官网注册",
    "Mark": "官网注册",
    "mark": "官网注册",
}

# ============================================================
# 纯展示/选项常量（后端无校验清单，仅入库字符串；统一收口避免前端手写）
# ============================================================

# 销售区域
REGIONS: list[str] = ["华东区", "华南区", "华北区", "海外"]

# 行业一级 → 二级
INDUSTRIES: dict[str, list[str]] = {
    "工业制造": ["机械 / 设备", "电子", "化工", "建材", "纺织", "包装", "汽车零部件"],
    "科技互联网": ["IT / 软件", "SaaS", "云计算", "AI", "大数据", "通信", "互联网服务", "企业服务"],
    "商贸零售": ["快消", "美妆", "服饰", "商超", "便利店", "电商", "母婴", "家居"],
    "医疗健康": ["医疗器械", "药品", "医院", "诊所", "医美", "体检", "生物科技"],
    "金融": ["银行", "保险", "证券", "支付", "企业金融", "FinTech"],
    "教育": ["K12", "高教", "职教", "教培", "教育装备", "在线教育"],
    "地产建筑": ["房产", "建筑", "工程", "装修", "物业", "建材"],
    "文旅餐饮": ["酒店", "餐饮", "旅游", "景区", "文娱", "传媒广告"],
    "农林牧渔": ["农业", "农资", "畜牧", "水产", "食品加工"],
    "政府与公共事业": ["政务", "公安", "交通", "能源", "水利", "环保", "科研"],
}

# 企业性质
COMPANY_NATURES: list[str] = ["有限责任公司", "股份有限公司", "外商投资企业", "个人独资企业"]

# 商机「项目类型」（交付类型，可多选；随机会写入 projectTypes）
OPPORTUNITY_PROJECT_TYPES: list[str] = ["监测", "排名优化", "词条优化"]

# 商机「优化周期」展示项（机会表单展示文案；与填报端 3/6/12 值域是两族）
OPPORTUNITY_OPT_PERIODS: list[str] = ["3 个月", "6 个月", "12 个月"]

# 商机输单原因树（一级 → 二级）
LOST_REASON_OPTIONS: dict[str, list[str]] = {
    "预算与价格原因": ["客户预算不足", "客户认为价格过高", "客户采购计划暂缓", "预算周期不匹配"],
    "采购与决策原因": ["客户决策变更", "客户内部推进停滞", "长时间未反馈", "客户回复不及时", "客户采购计划取消"],
    "产品与方案原因": [
        "产品能力不满足",
        "方案不满足客户需求",
        "不满足招标需求",
        "不支持客户所在行业",
        "客户 KPI 需求与我方方案不匹配",
    ],
    "服务与响应原因": ["服务支撑不足", "未能及时响应客户需求", "客户认为服务效果不理想", "客户对交付保障有顾虑"],
    "竞品原因": ["客户选择竞品", "竞品报价更低", "竞品截单", "竞品中标", "客户已有固定供应商"],
    "招投标原因": ["未中标", "招标文件需求不匹配", "内定供应商", "投标时间错过", "不满足招标资质要求"],
    "客户需求不匹配": ["客户目标与我方服务主张不一致", "客户需求超出当前服务范围", "客户行业暂不支持", "客户只做咨询了解，无明确采购意向"],
    "项目暂停或取消": ["项目暂停", "项目取消", "客户内部优先级调整", "市场节点已错过"],
    "商机质量问题": ["非真实商机", "为匹配顾问需求而创建", "线索质量不足", "客户无明确需求", "重复商机"],
    "其他原因": ["其他原因"],
}

# 合同类型 / 签约类型 / 合同来源（表单选项）
CONTRACT_TYPES: list[str] = ["新签", "续签", "增购"]
SIGN_TYPES: list[str] = ["线上电子签", "线下纸质签"]
CONTRACT_SOURCES: list[str] = [
    "市场",
    "机构推荐",
    "自己联系",
    "个人渠道资源",
    "渠道介绍",
    "KA",
    "渠道伙伴",
    "官网",
    "知乎",
    "蓝标",
    "阿里汇川",
    "瀚海",
    "市场投放",
    "展会",
    "自主开发",
    "生态推荐",
]

# 交付项目类型选项 / AI 平台选项（项目表单）
PROJECT_TYPE_OPTIONS: list[str] = ["品牌曝光", "舆情消除", "词条优化", "数据监控"]
PROJECT_PLATFORM_OPTIONS: list[str] = ["DeepSeek", "豆包", "元宝", "千问", "其他"]

# ============================================================
# 填报端表单值清单（与 geo-api 校验集合一致；label 仅展示）
# ============================================================
INTAKE_DOMESTIC_AI_PLATFORMS: list[str] = ["豆包", "DeepSeek", "元宝", "千问"]

INTAKE_OPTIMIZE_PERIODS: list[dict[str, str]] = [
    {"value": "3", "label": "3 个月"},
    {"value": "6", "label": "6 个月"},
    {"value": "12", "label": "12 个月"},
    {"value": "custom", "label": "自定义"},
]

INTAKE_DOMESTIC_GOALS: list[dict[str, str]] = [
    {"value": "recommend_60", "label": "推荐率 ≥ 60%"},
    {"value": "top3_60", "label": "前三推荐率 ≥ 60%"},
    {"value": "priority_60", "label": "优先推荐率 ≥ 60%"},
    {"value": "content", "label": "内容优化"},
    {"value": "sentiment", "label": "舆情"},
]

# 海外填报优化目标（仅值，label 在 i18n 翻译资源）
INTAKE_OVERSEAS_GOALS: list[str] = ["source", "recommend", "top3", "priority"]
