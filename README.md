# pureblue-geo-crm
一、项目概述 1.1 产品名称 GEO 客户经营与需求管理平台 内部简称： GEO 客户经营平台 / GEO CRM 1.2 产品定位 建设一个服务客户、SDR、销售、顾问、销售运营和管理人员的统一客户经营平台，打通从线索获取、客户沉淀、联系人维护、商机推进、需求收集、合同生成的完整业务链路。 平台采用： 一个平台，两个入口，共享一套客户数据。 - 对外入口：客户填写 GEO 项目需求单； - 对内入口：SDR、销售、顾问、Leader、销售运营管理线索、客户、商机、需求和合同。


## 公开源码演示

- `geo-admin/`：CRM 管理后台（Next.js）
- `geo-api/`：业务 API（FastAPI、SQLAlchemy、Alembic）
- `geo-intake/`：客户需求填报入口（Next.js）

本仓库是源码演示，不连接公司 CRM 或真实业务数据库。前端请分别安装依赖并参考各目录的环境变量示例；API 请配置独立的空 MySQL 数据库、随机 JWT 密钥，执行 `alembic upgrade head` 后运行 `uvicorn app.main:app --port 8000`。开发登录只用于本地演示，禁止用于公网部署。GitHub 仓库本身不是在线演示站点。
