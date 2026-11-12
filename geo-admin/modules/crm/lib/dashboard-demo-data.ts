import {
  OPP_FLOW_STAGES,
  type Contract,
  type Customer,
  type Lead,
  type Opportunity,
  type PaymentPlan,
} from "@/modules/crm/lib/crm-data"

export const DASHBOARD_TEST_MODE = true

type DashboardDemoData = {
  leads: Lead[]
  customers: Customer[]
  opportunities: Opportunity[]
  contracts: Contract[]
  paymentPlans: PaymentPlan[]
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthDate(monthOffset: number, preferredDay = 12) {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  const day = monthOffset === 0 ? now.getDate() : Math.min(preferredDay, lastDay)
  target.setDate(day)
  return ymd(target)
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return ymd(date)
}

function previousPeriodDate() {
  const now = new Date()
  return ymd(new Date(now.getFullYear(), now.getMonth(), 0))
}

function yearAgoDate() {
  const now = new Date()
  now.setFullYear(now.getFullYear() - 1)
  return ymd(now)
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function historyUntil(stageIndex: number) {
  return OPP_FLOW_STAGES.slice(0, stageIndex + 1).map((stage, index) => ({
    stage,
    enteredAt: `${daysAgo(Math.max(0, (stageIndex - index + 1) * 3))}T09:00:00`,
    leftAt: index < stageIndex ? `${daysAgo(Math.max(0, (stageIndex - index) * 3))}T17:00:00` : undefined,
    reason: index === 0 ? "测试样本：完成首次有效沟通" : "测试样本：阶段条件已满足",
    changeType: "advance" as const,
  }))
}

export function createDashboardDemoData(primaryOwner: string): DashboardDemoData {
  const owners = unique([primaryOwner || "当前用户", "张敏", "李哲", "王蕾"])
  const sources = ["自拓", "机构引荐", "内容营销", "三方会议"]
  const regions = ["华北", "华东", "华南", "华中", "西南", "西北"]
  const cities = ["北京", "上海", "广州", "武汉", "成都", "西安"]
  const customerStatuses: Customer["status"][] = ["awaiting_contact", "connected", "opportunity_following", "cooperating", "stopped"]
  const today = monthDate(0)
  const priorMonth = previousPeriodDate()
  const priorYear = yearAgoDate()
  const leads: Lead[] = []
  const customers: Customer[] = []
  const opportunities: Opportunity[] = []
  const contracts: Contract[] = []
  const paymentPlans: PaymentPlan[] = []

  owners.forEach((owner, ownerIndex) => {
    const ownerCode = `owner-${ownerIndex + 1}`

    sources.forEach((source, sourceIndex) => {
      const customerId = `dashboard-test-customer-${ownerCode}-${sourceIndex + 1}`
      leads.push({
        id: `dashboard-test-lead-${ownerCode}-${sourceIndex + 1}`,
        createdAt: today,
        firstContactDate: today,
        transferDate: sourceIndex === 1 ? today : "",
        source,
        sourceDetail: `测试${source}`,
        companyName: `测试线索企业${ownerIndex + 1}-${sourceIndex + 1}`,
        brandName: `测试品牌${ownerIndex + 1}${sourceIndex + 1}`,
        city: cities[(ownerIndex + sourceIndex) % cities.length] || "北京",
        region: regions[(ownerIndex + sourceIndex) % regions.length] || "华北",
        contactName: `测试联系人${sourceIndex + 1}`,
        contactTitle: "市场负责人",
        contactPhone: `1380000${ownerIndex}${sourceIndex}01`,
        email: `dashboard${ownerIndex}${sourceIndex}@example.test`,
        sdr: `SDR${ownerIndex + 1}`,
        sales: owner,
        level: (["A", "B", "C", "D"] as const)[sourceIndex] || "B",
        followState: sourceIndex === 1 ? "converted" : sourceIndex === 3 ? "no_need" : "need",
        status: (["touched", "converted", "untouched", "invalid"] as const)[sourceIndex] || "touched",
        invalidReason: sourceIndex === 3 ? "测试样本：暂不符合目标客户画像" : undefined,
        notes: [{ id: `dashboard-test-lead-note-${ownerCode}-${sourceIndex}`, author: owner, content: "测试跟进：已完成首次沟通", date: today, followType: "online" }],
        convertedCustomerId: sourceIndex === 1 ? customerId : undefined,
      })
    })
    sources.forEach((source, sourceIndex) => {
      const base = leads.find((item) => item.id === `dashboard-test-lead-${ownerCode}-${sourceIndex + 1}`)!
      for (let extra = 1; extra <= 3 - sourceIndex; extra += 1) {
        leads.push({
          ...base,
          id: `${base.id}-extra-${extra}`,
          companyName: `测试${source}线索${ownerIndex + 1}-${sourceIndex + 1}-${extra + 1}`,
          notes: base.notes.map((note) => ({ ...note, id: `${note.id}-extra-${extra}` })),
        })
      }
    })

    leads.push({
      ...leads.find((item) => item.id === `dashboard-test-lead-${ownerCode}-1`)!,
      id: `dashboard-test-lead-prior-${ownerCode}`,
      companyName: `上期测试线索企业${ownerIndex + 1}`,
      createdAt: priorMonth,
      firstContactDate: priorMonth,
      transferDate: "",
      status: "touched",
      followState: "need",
      convertedCustomerId: undefined,
      notes: [],
    })
    ;[1, 2].forEach((sourceNumber) => {
      const base = leads.find((item) => item.id === `dashboard-test-lead-${ownerCode}-${sourceNumber}`)!
      leads.push({ ...base, id: `dashboard-test-lead-year-${ownerCode}-${sourceNumber}`, companyName: `去年同期测试线索${ownerIndex + 1}-${sourceNumber}`, createdAt: priorYear, firstContactDate: priorYear, transferDate: sourceNumber === 2 ? priorYear : "", notes: [] })
    })

    customerStatuses.forEach((status, statusIndex) => {
      customers.push({
        id: `dashboard-test-customer-${ownerCode}-${statusIndex + 1}`,
        companyName: `测试客户企业${ownerIndex + 1}-${statusIndex + 1}`,
        brandName: `测试客户品牌${ownerIndex + 1}${statusIndex + 1}`,
        region: regions[(ownerIndex + statusIndex) % regions.length] || "华北",
        city: cities[(ownerIndex + statusIndex) % cities.length] || "北京",
        industryL1: "企业服务",
        industryL2: "数字营销",
        foundedDate: "2018-05-18",
        creditCode: `TEST91110000${ownerIndex}${statusIndex}`,
        registeredCapital: 1000 + statusIndex * 500,
        annualRevenue: 3000 + statusIndex * 800,
        scale: "100-499人",
        nature: "民营企业",
        status,
        owner,
        sdrTransferDate: today,
        lastFollowAt: today,
        source: sources[statusIndex % sources.length] || "自拓",
        isKey: statusIndex === 3,
        createdAt: today,
        contacts: [{ id: `dashboard-test-contact-${ownerCode}-${statusIndex}`, name: `测试联系人${statusIndex + 1}`, title: "业务负责人", phone: `1390000${ownerIndex}${statusIndex}02`, email: `customer${ownerIndex}${statusIndex}@example.test`, isPrimary: true, active: true, wechatAdded: true, createdAt: today }],
        notes: [{ id: `dashboard-test-customer-note-${ownerCode}-${statusIndex}`, author: owner, content: "测试跟进：已同步下一步合作安排", date: today, followType: "online" }],
      })
    })
    customerStatuses.forEach((_, statusIndex) => {
      const base = customers.find((item) => item.id === `dashboard-test-customer-${ownerCode}-${statusIndex + 1}`)!
      for (let extra = 1; extra <= 4 - statusIndex; extra += 1) {
        customers.push({
          ...base,
          id: `${base.id}-extra-${extra}`,
          companyName: `${base.companyName}-样本${extra + 1}`,
          contacts: base.contacts.map((contact) => ({ ...contact, id: `${contact.id}-extra-${extra}` })),
          notes: base.notes.map((note) => ({ ...note, id: `${note.id}-extra-${extra}` })),
        })
      }
    })

    customers.push({
      ...customers.find((item) => item.id === `dashboard-test-customer-${ownerCode}-1`)!,
      id: `dashboard-test-customer-prior-${ownerCode}`,
      companyName: `上期测试客户企业${ownerIndex + 1}`,
      createdAt: priorMonth,
      lastFollowAt: priorMonth,
      notes: [],
    })
    ;[1, 2].forEach((statusNumber) => {
      const base = customers.find((item) => item.id === `dashboard-test-customer-${ownerCode}-${statusNumber}`)!
      customers.push({ ...base, id: `dashboard-test-customer-year-${ownerCode}-${statusNumber}`, companyName: `去年同期测试客户${ownerIndex + 1}-${statusNumber}`, createdAt: priorYear, lastFollowAt: priorYear, notes: [] })
    })

    OPP_FLOW_STAGES.forEach((stage, stageIndex) => {
      opportunities.push({
        id: `dashboard-test-opp-${ownerCode}-${stage}`,
        name: `测试商机${ownerIndex + 1}-${stageIndex + 1}`,
        customerId: `dashboard-test-customer-${ownerCode}-${(stageIndex % customerStatuses.length) + 1}`,
        brandName: `测试商机品牌${ownerIndex + 1}${stageIndex + 1}`,
        region: regions[(ownerIndex + stageIndex) % regions.length] || "华北",
        geoSource: stageIndex % 2 ? "overseas" : "domestic",
        goal: "品牌曝光",
        platform: stageIndex % 2 ? "Gemini" : "DeepSeek",
        period: "6个月",
        amount: 120_000 + stageIndex * 35_000 + ownerIndex * 20_000,
        probability: Math.min(95, 15 + stageIndex * 11),
        expectedSignDate: monthDate(1),
        stage,
        owner,
        projectTypes: ["品牌曝光"],
        primaryContactId: `dashboard-test-contact-${ownerCode}-${stageIndex % customerStatuses.length}`,
        requestIds: [],
        notes: [{ id: `dashboard-test-opp-note-${ownerCode}-${stageIndex}`, author: owner, content: "测试跟进：商机阶段推进中", date: today, followType: "offline" }],
        advisorNotes: [],
        createdAt: today,
        lastFollowAt: stageIndex % 3 === 0 ? daysAgo(36 + ownerIndex) : today,
        stageHistory: historyUntil(stageIndex),
      })
    })
    OPP_FLOW_STAGES.forEach((stage, stageIndex) => {
      const base = opportunities.find((item) => item.id === `dashboard-test-opp-${ownerCode}-${stage}`)!
      for (let extra = 1; extra <= OPP_FLOW_STAGES.length - stageIndex - 1; extra += 1) {
        opportunities.push({
          ...base,
          id: `${base.id}-extra-${extra}`,
          name: `${base.name}-样本${extra + 1}`,
          amount: base.amount + extra * 12_000,
          notes: base.notes.map((note) => ({ ...note, id: `${note.id}-extra-${extra}` })),
        })
      }
    })

    opportunities.push({
      ...opportunities.find((item) => item.id === `dashboard-test-opp-${ownerCode}-contact`)!,
      id: `dashboard-test-opp-${ownerCode}-lost`,
      name: `测试输单商机${ownerIndex + 1}`,
      stage: "lost",
      amount: 180_000 + ownerIndex * 30_000,
      lostReasonL1: "价格因素",
      lostReasonL2: (["预算不足", "竞品价格更低", "采购计划取消", "决策周期过长"] as const)[ownerIndex % 4],
      competitor: "测试竞品",
      stageHistory: historyUntil(Math.min(ownerIndex + 2, OPP_FLOW_STAGES.length - 2)),
    })
    const lostBase = opportunities.find((item) => item.id === `dashboard-test-opp-${ownerCode}-lost`)!
    for (let extra = 1; extra <= 3 - ownerIndex; extra += 1) {
      opportunities.push({
        ...lostBase,
        id: `${lostBase.id}-extra-${extra}`,
        name: `${lostBase.name}-样本${extra + 1}`,
        amount: lostBase.amount + extra * 15_000,
        notes: lostBase.notes.map((note) => ({ ...note, id: `${note.id}-extra-${extra}` })),
      })
    }

    opportunities.push({
      ...opportunities.find((item) => item.id === `dashboard-test-opp-${ownerCode}-contact`)!,
      id: `dashboard-test-opp-prior-${ownerCode}`,
      name: `上期测试商机${ownerIndex + 1}`,
      createdAt: priorMonth,
      lastFollowAt: priorMonth,
      stage: "solution_confirm",
      stageHistory: historyUntil(3),
    })
    opportunities.push({ ...lostBase, id: `dashboard-test-opp-prior-lost-${ownerCode}`, name: `上期测试输单商机${ownerIndex + 1}`, createdAt: priorMonth, lastFollowAt: priorMonth, notes: [] })
    ;["contact", "solution_confirm", "lost"].forEach((stage, yearIndex) => {
      const base = stage === "lost" ? lostBase : opportunities.find((item) => item.id === `dashboard-test-opp-${ownerCode}-${stage}`)!
      opportunities.push({ ...base, id: `dashboard-test-opp-year-${ownerCode}-${stage}`, name: `去年同期测试商机${ownerIndex + 1}-${yearIndex + 1}`, createdAt: priorYear, lastFollowAt: priorYear, notes: [] })
    })

    const currentCustomerId = `dashboard-test-customer-${ownerCode}-4`
    const currentSignedId = `dashboard-test-contract-signed-${ownerCode}`
    const renewalId = `dashboard-test-contract-renewal-${ownerCode}`
    const priorSignedId = `dashboard-test-contract-prior-${ownerCode}`
    const priorRenewalId = `dashboard-test-contract-prior-renewal-${ownerCode}`
    const yearSignedId = `dashboard-test-contract-year-${ownerCode}`
    const yearRenewalId = `dashboard-test-contract-year-renewal-${ownerCode}`
    const contractBase: Contract = {
      id: currentSignedId,
      code: `HT-TEST-${ownerIndex + 1}01`,
      name: `测试年度优化服务合同${ownerIndex + 1}`,
      customerId: currentCustomerId,
      company: `测试客户企业${ownerIndex + 1}-4`,
      region: regions[ownerIndex % regions.length] || "华北",
      city: cities[ownerIndex % cities.length] || "北京",
      geoSource: "domestic",
      type: "GEO优化服务",
      signType: "新签",
      source: "商机转合同",
      status: "signed",
      projectStatus: "ongoing",
      signSubject: `测试客户企业${ownerIndex + 1}-4`,
      ourSignSubject: "PureBlue测试主体",
      customerSignSubject: `测试客户企业${ownerIndex + 1}-4`,
      signer: owner,
      owner,
      owners: [owner],
      signerManager: "测试销售主管",
      dept: ownerIndex % 2 ? "华东销售部" : "华北销售部",
      amount: 420_000 + ownerIndex * 80_000,
      effectiveDate: today,
      dualSignDate: today,
      validMonths: 12,
      endDate: monthDate(12),
      attachments: [{ id: `dashboard-test-contract-file-${ownerCode}`, name: "测试合同.pdf", kind: "contract" }],
      opportunityId: `dashboard-test-opp-${ownerCode}-won`,
      createdAt: today,
    }
    contracts.push(contractBase)
    contracts.push({ ...contractBase, id: `dashboard-test-contract-pending-${ownerCode}`, code: `HT-TEST-${ownerIndex + 1}02`, name: `测试待签合同${ownerIndex + 1}`, status: "pending", amount: 260_000 + ownerIndex * 30_000, opportunityId: `dashboard-test-opp-${ownerCode}-signing` })
    contracts.push({ ...contractBase, id: renewalId, code: `HT-TEST-${ownerIndex + 1}03`, name: `测试待续约合同${ownerIndex + 1}`, amount: 300_000 + ownerIndex * 50_000, endDate: today })
    contracts.push({ ...contractBase, id: priorSignedId, code: `HT-TEST-${ownerIndex + 1}00`, name: `上期测试合同${ownerIndex + 1}`, amount: 350_000 + ownerIndex * 60_000, effectiveDate: priorMonth, dualSignDate: priorMonth, createdAt: priorMonth })
    contracts.push({ ...contractBase, id: `dashboard-test-contract-prior-pending-${ownerCode}`, code: `HT-TEST-${ownerIndex + 1}P1`, name: `上期待签测试合同${ownerIndex + 1}`, status: "pending", amount: 190_000 + ownerIndex * 20_000, effectiveDate: priorMonth, dualSignDate: priorMonth, createdAt: priorMonth })
    contracts.push({ ...contractBase, id: priorRenewalId, code: `HT-TEST-${ownerIndex + 1}R1`, name: `上期待续约测试合同${ownerIndex + 1}`, amount: 240_000 + ownerIndex * 35_000, effectiveDate: priorMonth, dualSignDate: priorMonth, endDate: priorMonth, createdAt: priorMonth })
    contracts.push({ ...contractBase, id: yearSignedId, code: `HT-TEST-${ownerIndex + 1}Y1`, name: `去年同期测试合同${ownerIndex + 1}`, amount: 280_000 + ownerIndex * 45_000, effectiveDate: priorYear, dualSignDate: priorYear, createdAt: priorYear })
    contracts.push({ ...contractBase, id: `dashboard-test-contract-year-pending-${ownerCode}`, code: `HT-TEST-${ownerIndex + 1}Y2`, name: `去年同期待签合同${ownerIndex + 1}`, status: "pending", amount: 150_000 + ownerIndex * 15_000, effectiveDate: priorYear, dualSignDate: priorYear, createdAt: priorYear })
    contracts.push({ ...contractBase, id: yearRenewalId, code: `HT-TEST-${ownerIndex + 1}Y3`, name: `去年同期待续约合同${ownerIndex + 1}`, amount: 210_000 + ownerIndex * 25_000, effectiveDate: priorYear, dualSignDate: priorYear, endDate: priorYear, createdAt: priorYear })

    ;[currentSignedId, renewalId].forEach((contractId, planIndex) => {
      const contract = contracts.find((item) => item.id === contractId)!
      const plannedAmount = Math.round(contract.amount / 2)
      paymentPlans.push({
        id: `dashboard-test-payment-${ownerCode}-${planIndex + 1}`,
        contractId,
        contractCode: contract.code,
        contractName: contract.name,
        contractAmount: contract.amount,
        company: contract.company,
        salesOwner: owner,
        periodIndex: planIndex + 1,
        periodName: `第${planIndex + 1}期`,
        plannedAmount,
        plannedDate: today,
        invoiceStatus: planIndex ? "uninvoiced" : "invoiced",
        invoiceDate: planIndex ? undefined : today,
        invoiceAmount: planIndex ? null : plannedAmount,
        actualPaymentDate: planIndex ? undefined : today,
        actualAmount: planIndex ? 0 : Math.round(plannedAmount * 0.45),
        paymentStatus: planIndex ? "pending" : "partial",
        outstandingAmount: planIndex ? plannedAmount : plannedAmount - Math.round(plannedAmount * 0.45),
        createdBy: "测试数据生成器",
        updatedBy: "测试数据生成器",
        createdAt: today,
        updatedAt: today,
      })
    })
    ;[
      { contractId: priorSignedId, plannedDate: priorMonth, ratio: 0.7 },
      { contractId: priorRenewalId, plannedDate: priorMonth, ratio: 0.55 },
      { contractId: yearSignedId, plannedDate: priorYear, ratio: 0.6 },
      { contractId: yearRenewalId, plannedDate: priorYear, ratio: 0.5 },
    ].forEach((sample, sampleIndex) => {
      if ((sampleIndex < 2 && ownerIndex === 3) || (sampleIndex >= 2 && ownerIndex >= 2)) return
      const contract = contracts.find((item) => item.id === sample.contractId)!
      const plannedAmount = Math.round(contract.amount * sample.ratio)
      const actualAmount = Math.round(plannedAmount * (0.15 + sampleIndex * 0.05))
      paymentPlans.push({ id: `dashboard-test-payment-history-${ownerCode}-${sampleIndex + 1}`, contractId: sample.contractId, contractCode: contract.code, contractName: contract.name, contractAmount: contract.amount, company: contract.company, salesOwner: owner, periodIndex: 1, periodName: "第一期", plannedAmount, plannedDate: sample.plannedDate, invoiceStatus: sampleIndex % 2 ? "uninvoiced" : "invoiced", invoiceDate: sampleIndex % 2 ? undefined : sample.plannedDate, invoiceAmount: sampleIndex % 2 ? null : plannedAmount, actualPaymentDate: actualAmount ? sample.plannedDate : undefined, actualAmount, paymentStatus: actualAmount > 0 ? "partial" : "pending", outstandingAmount: plannedAmount - actualAmount, createdBy: "测试数据生成器", updatedBy: "测试数据生成器", createdAt: sample.plannedDate, updatedAt: sample.plannedDate })
    })
  })

  return { leads, customers, opportunities, contracts, paymentPlans }
}
