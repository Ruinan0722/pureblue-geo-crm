import type { SearchableSelectOption } from "@/shared/ui/searchable-select"
import { REGIONS } from "@/modules/crm/lib/crm-data"

/** 销售区域由唯一权威源 REGIONS（status-catalog.generated）派生 */
export type SalesRegion = (typeof REGIONS)[number]

/**
 * 区域 → 城市（销售辖区划分）
 * - 华东：沪苏浙皖闽赣鲁
 * - 华南：粤桂琼 + 港澳
 * - 华北：京津冀晋蒙 + 东北 + 华中 + 西南 + 西北（除华东/华南外的大陆城市）
 * - 海外：境外城市
 */
export const REGION_CITIES: Record<SalesRegion, readonly string[]> = {
  华东区: [
    "上海",
    "南京",
    "无锡",
    "徐州",
    "常州",
    "苏州",
    "南通",
    "连云港",
    "淮安",
    "盐城",
    "扬州",
    "镇江",
    "泰州",
    "宿迁",
    "杭州",
    "宁波",
    "温州",
    "嘉兴",
    "湖州",
    "绍兴",
    "金华",
    "衢州",
    "舟山",
    "台州",
    "丽水",
    "合肥",
    "芜湖",
    "蚌埠",
    "淮南",
    "马鞍山",
    "淮北",
    "铜陵",
    "安庆",
    "黄山",
    "滁州",
    "阜阳",
    "宿州",
    "六安",
    "亳州",
    "池州",
    "宣城",
    "福州",
    "厦门",
    "莆田",
    "三明",
    "泉州",
    "漳州",
    "南平",
    "龙岩",
    "宁德",
    "南昌",
    "景德镇",
    "萍乡",
    "九江",
    "新余",
    "鹰潭",
    "赣州",
    "吉安",
    "宜春",
    "抚州",
    "上饶",
    "济南",
    "青岛",
    "淄博",
    "枣庄",
    "东营",
    "烟台",
    "潍坊",
    "济宁",
    "泰安",
    "威海",
    "日照",
    "临沂",
    "德州",
    "聊城",
    "滨州",
    "菏泽",
  ],
  华南区: [
    "广州",
    "韶关",
    "深圳",
    "珠海",
    "汕头",
    "佛山",
    "江门",
    "湛江",
    "茂名",
    "肇庆",
    "惠州",
    "梅州",
    "汕尾",
    "河源",
    "阳江",
    "清远",
    "东莞",
    "中山",
    "潮州",
    "揭阳",
    "云浮",
    "南宁",
    "柳州",
    "桂林",
    "梧州",
    "北海",
    "防城港",
    "钦州",
    "贵港",
    "玉林",
    "百色",
    "贺州",
    "河池",
    "来宾",
    "崇左",
    "海口",
    "三亚",
    "三沙",
    "儋州",
    "香港",
    "澳门",
  ],
  华北区: [
    "北京",
    "天津",
    "石家庄",
    "唐山",
    "秦皇岛",
    "邯郸",
    "邢台",
    "保定",
    "张家口",
    "承德",
    "沧州",
    "廊坊",
    "衡水",
    "太原",
    "大同",
    "阳泉",
    "长治",
    "晋城",
    "朔州",
    "晋中",
    "运城",
    "忻州",
    "临汾",
    "吕梁",
    "呼和浩特",
    "包头",
    "乌海",
    "赤峰",
    "通辽",
    "鄂尔多斯",
    "呼伦贝尔",
    "巴彦淖尔",
    "乌兰察布",
    "沈阳",
    "大连",
    "鞍山",
    "抚顺",
    "本溪",
    "丹东",
    "锦州",
    "营口",
    "阜新",
    "辽阳",
    "盘锦",
    "铁岭",
    "朝阳",
    "葫芦岛",
    "长春",
    "吉林",
    "四平",
    "辽源",
    "通化",
    "白山",
    "松原",
    "白城",
    "哈尔滨",
    "齐齐哈尔",
    "鸡西",
    "鹤岗",
    "双鸭山",
    "大庆",
    "伊春",
    "佳木斯",
    "七台河",
    "牡丹江",
    "黑河",
    "绥化",
    "郑州",
    "开封",
    "洛阳",
    "平顶山",
    "安阳",
    "鹤壁",
    "新乡",
    "焦作",
    "濮阳",
    "许昌",
    "漯河",
    "三门峡",
    "南阳",
    "商丘",
    "信阳",
    "周口",
    "驻马店",
    "武汉",
    "黄石",
    "十堰",
    "宜昌",
    "襄阳",
    "鄂州",
    "荆门",
    "孝感",
    "荆州",
    "黄冈",
    "咸宁",
    "随州",
    "长沙",
    "株洲",
    "湘潭",
    "衡阳",
    "邵阳",
    "岳阳",
    "常德",
    "张家界",
    "益阳",
    "郴州",
    "永州",
    "怀化",
    "娄底",
    "重庆",
    "成都",
    "自贡",
    "攀枝花",
    "泸州",
    "德阳",
    "绵阳",
    "广元",
    "遂宁",
    "内江",
    "乐山",
    "南充",
    "眉山",
    "宜宾",
    "广安",
    "达州",
    "雅安",
    "巴中",
    "资阳",
    "贵阳",
    "六盘水",
    "遵义",
    "安顺",
    "毕节",
    "铜仁",
    "昆明",
    "曲靖",
    "玉溪",
    "保山",
    "昭通",
    "丽江",
    "普洱",
    "临沧",
    "拉萨",
    "日喀则",
    "昌都",
    "林芝",
    "山南",
    "那曲",
    "西安",
    "铜川",
    "宝鸡",
    "咸阳",
    "渭南",
    "延安",
    "汉中",
    "榆林",
    "安康",
    "商洛",
    "兰州",
    "嘉峪关",
    "金昌",
    "白银",
    "天水",
    "武威",
    "张掖",
    "平凉",
    "酒泉",
    "庆阳",
    "定西",
    "陇南",
    "西宁",
    "海东",
    "银川",
    "石嘴山",
    "吴忠",
    "固原",
    "中卫",
    "乌鲁木齐",
    "克拉玛依",
    "吐鲁番",
    "哈密",
  ],
  海外: ["新加坡", "东京", "首尔", "纽约", "伦敦", "悉尼", "迪拜"],
}

const CITY_TO_REGION: Record<string, SalesRegion> = (() => {
  const map: Record<string, SalesRegion> = {}
  for (const region of Object.keys(REGION_CITIES) as SalesRegion[]) {
    for (const city of REGION_CITIES[region]) {
      map[city] = region
    }
  }
  return map
})()

export const CHINA_CITIES: readonly string[] = (Object.keys(REGION_CITIES) as SalesRegion[]).flatMap(
  (region) => [...REGION_CITIES[region]],
)

export function regionForCity(city: string): SalesRegion | null {
  const key = city.trim()
  return CITY_TO_REGION[key] ?? null
}

export function citiesForRegion(region: string): readonly string[] {
  if (region in REGION_CITIES) {
    return REGION_CITIES[region as SalesRegion]
  }
  return []
}

export function cityBelongsToRegion(city: string, region: string): boolean {
  if (!city.trim()) return true
  const mapped = regionForCity(city)
  // 自定义/历史未知城市不强清；已知城市必须与区域一致
  if (!mapped) return true
  return mapped === region
}

/** 全国城市选项（可搜索） */
export function chinaCityOptions(): SearchableSelectOption[] {
  return CHINA_CITIES.map((city) => ({ value: city, label: city }))
}

/** 某区域下的城市选项；当前城市若不在列表中仍置顶，便于编辑历史数据 */
export function cityOptionsForRegion(region: string, currentCity?: string): SearchableSelectOption[] {
  const list = [...citiesForRegion(region)]
  const current = currentCity?.trim()
  if (current && !list.includes(current)) list.unshift(current)
  return list.map((city) => ({ value: city, label: city }))
}

/**
 * 区域 / 城市联动：
 * - 改区域：若当前城市不属于新区，清空城市
 * - 改城市：自动带出所属区域
 */
export function applyRegionCityChange(
  current: { region: string; city: string },
  patch: { region?: string; city?: string },
): { region: string; city: string } {
  if (patch.city !== undefined) {
    const city = patch.city.trim()
    const mapped = regionForCity(city)
    return {
      city,
      region: mapped ?? current.region,
    }
  }
  if (patch.region !== undefined) {
    const region = patch.region
    const keepCity = cityBelongsToRegion(current.city, region) ? current.city : ""
    return { region, city: keepCity }
  }
  return current
}
