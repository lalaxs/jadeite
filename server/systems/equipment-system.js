import { equipmentRepairQuote } from "../../shared/domain/economy/equipment-maintenance.js";
import { OWNER_OPERATOR_ID } from "../../shared/domain/economy/public-workstations.js";

const BRAND_LINES = [
  {
    brandKey: "cuijie",
    brand: "翠捷",
    code: "CJ",
    positioning: "入门快周转",
    priceTier: "入门",
    startingPrice: 6800,
    profile: "入门快周转：低售价、高速度、高风险。",
    stages: {
      opening: [
        { modelKey: "cuijie-opening-1", name: "开料快切线", modelName: "CJ-O1 快切型", category: "打磨机", price: 7600, quality: 2, risk: 1.18, speed: 15, perfectFloor: 0, focus: "高速周转", description: "低价快切入门款，适合早期把暗料快速推进到开料阶段。" },
        { modelKey: "cuijie-opening-2", name: "连续精磨线", modelName: "CJ-O2 连磨型", category: "精磨机", price: 9200, quality: 3, risk: 1.16, speed: 17, perfectFloor: 0, focus: "连续加工", description: "连续精磨效率高，适合快速处理低中价位料子。" },
        { modelKey: "cuijie-opening-3", name: "高速水切线", modelName: "CJ-O3 高速型", category: "水床切片机", price: 11800, quality: 4, risk: 1.22, speed: 18, perfectFloor: 0, focus: "极限速度", description: "用更高风险换最高开料速度，适合现金流优先的工坊。" }
      ],
      carving: [
        { modelKey: "cuijie-carving-1", name: "轻量套料线", modelName: "CJ-C1 轻套型", category: "套料机", price: 8800, quality: 2, risk: 1.18, speed: 14, perfectFloor: 0, focus: "轻量套料", description: "轻量结构，取件快但容错一般。" },
        { modelKey: "cuijie-carving-2", name: "快取套件线", modelName: "CJ-C2 快取型", category: "取件机", price: 11200, quality: 3, risk: 1.16, speed: 16, perfectFloor: 0, focus: "快速取件", description: "缩短取件耗时，适合普通件的高速流转。" },
        { modelKey: "cuijie-carving-3", name: "快线规划线", modelName: "CJ-C3 快线型", category: "扫描设计台", price: 13600, quality: 4, risk: 1.20, speed: 17, perfectFloor: 0, focus: "规划效率", description: "牺牲精细度上限，换取规划阶段的快进快出。" }
      ],
      finishing: [
        { modelKey: "cuijie-finishing-1", name: "快速抛光线", modelName: "CJ-F1 快抛型", category: "玉雕机·抛光机", price: 8600, quality: 2, risk: 1.17, speed: 13, perfectFloor: 0, focus: "快速抛光", description: "用较低成本完成基础出光，适合低客单成品。" },
        { modelKey: "cuijie-finishing-2", name: "连续收光线", modelName: "CJ-F2 连抛型", category: "镶嵌机", price: 10800, quality: 3, risk: 1.16, speed: 15, perfectFloor: 0, focus: "连续收口", description: "适合连续完成简易镶嵌和基础收口。" },
        { modelKey: "cuijie-finishing-3", name: "快收高光线", modelName: "CJ-F3 快收型", category: "高光精雕机", price: 13200, quality: 4, risk: 1.21, speed: 16, perfectFloor: 0, focus: "快速收尾", description: "高周转收尾型号，风险高于稳健设备。" }
      ]
    }
  },
  {
    brandKey: "wenyu",
    brand: "稳玉",
    code: "WY",
    positioning: "稳健保料",
    priceTier: "稳健",
    startingPrice: 11200,
    profile: "稳健保料：中档售价、低风险、保底高。",
    stages: {
      opening: [
        { modelKey: "wenyu-opening-1", name: "稳定开料线", modelName: "WY-O1 稳开型", category: "打磨机", price: 9800, quality: 4, risk: 0.86, speed: 5, perfectFloor: 2, focus: "低风险", description: "保守开料入门款，降低早期崩裂波动。" },
        { modelKey: "wenyu-opening-2", name: "净面精磨线", modelName: "WY-O2 净磨型", category: "精磨机", price: 12600, quality: 5, risk: 0.82, speed: 4, perfectFloor: 3, focus: "稳定净面", description: "标准稳健款，适合看重开料质量下限的工坊。" },
        { modelKey: "wenyu-opening-3", name: "低裂水切线", modelName: "WY-O3 低裂型", category: "水床切片机", price: 15600, quality: 6, risk: 0.78, speed: 4, perfectFloor: 4, focus: "低裂保底", description: "用更慢节奏换低裂风险和更高完美度下限。" }
      ],
      carving: [
        { modelKey: "wenyu-carving-1", name: "稳线套料线", modelName: "WY-C1 稳线型", category: "套料机", price: 10400, quality: 4, risk: 0.88, speed: 5, perfectFloor: 2, focus: "稳线取料", description: "按边界慢速取料，适合怕压裂的料子。" },
        { modelKey: "wenyu-carving-2", name: "精取稳定线", modelName: "WY-C2 精取型", category: "取件机", price: 13800, quality: 5, risk: 0.84, speed: 4, perfectFloor: 3, focus: "精取下限", description: "稳定取件主力款，降低规划阶段损耗。" },
        { modelKey: "wenyu-carving-3", name: "保料扫描线", modelName: "WY-C3 保料型", category: "扫描设计台", price: 16800, quality: 6, risk: 0.80, speed: 3, perfectFloor: 4, focus: "保料规划", description: "更慢的扫描和切线策略，尽量保住高价值套件。" }
      ],
      finishing: [
        { modelKey: "wenyu-finishing-1", name: "稳定抛光线", modelName: "WY-F1 稳抛型", category: "玉雕机·抛光机", price: 10200, quality: 4, risk: 0.88, speed: 5, perfectFloor: 2, focus: "稳抛", description: "基础收口更稳，适合常规成品线。" },
        { modelKey: "wenyu-finishing-2", name: "净光镶嵌线", modelName: "WY-F2 净光型", category: "镶嵌机", price: 13400, quality: 5, risk: 0.84, speed: 4, perfectFloor: 3, focus: "净光下限", description: "净光和镶嵌容错更好，提升成品稳定性。" },
        { modelKey: "wenyu-finishing-3", name: "低损高光线", modelName: "WY-F3 低损型", category: "高光精雕机", price: 16600, quality: 6, risk: 0.80, speed: 3, perfectFloor: 4, focus: "低损收口", description: "慢速精修型号，减少最后一步翻车。" }
      ]
    }
  },
  {
    brandKey: "shuiheng",
    brand: "水衡",
    code: "SH",
    positioning: "水冷控裂",
    priceTier: "中高端",
    startingPrice: 12800,
    profile: "水冷控裂：中高售价，开料控裂和均衡加工。",
    stages: {
      opening: [
        { modelKey: "shuiheng-opening-1", name: "水冷打磨线", modelName: "SH-O1 水磨型", category: "打磨机", price: 10400, quality: 4, risk: 0.96, speed: 8, perfectFloor: 1, focus: "水冷稳定", description: "水冷打磨降低热损，开料表现均衡。" },
        { modelKey: "shuiheng-opening-2", name: "冷切精磨线", modelName: "SH-O2 冷切型", category: "精磨机", price: 13200, quality: 5, risk: 0.90, speed: 7, perfectFloor: 2, focus: "冷切控裂", description: "加强冷却的标准款，适合中高价料开窗。" },
        { modelKey: "shuiheng-opening-3", name: "水床主切线", modelName: "SH-O3 水床型", category: "水床切片机", price: 16800, quality: 6, risk: 0.86, speed: 8, perfectFloor: 3, focus: "水床切片", description: "品牌核心水床型号，开料稳定且质量上限更高。" }
      ],
      carving: [
        { modelKey: "shuiheng-carving-1", name: "冷线套料线", modelName: "SH-C1 冷线型", category: "套料机", price: 11000, quality: 4, risk: 0.98, speed: 8, perfectFloor: 1, focus: "冷线套料", description: "用水冷控制细裂，适合边界较紧的套件。" },
        { modelKey: "shuiheng-carving-2", name: "水冷取件线", modelName: "SH-C2 水冷取件", category: "取件机", price: 14200, quality: 5, risk: 0.92, speed: 7, perfectFloor: 2, focus: "水冷取件", description: "取件过程控温更好，降低裂纹扩散。" },
        { modelKey: "shuiheng-carving-3", name: "稳温扫描线", modelName: "SH-C3 稳温扫描", category: "扫描设计台", price: 17600, quality: 6, risk: 0.88, speed: 6, perfectFloor: 3, focus: "稳温规划", description: "扫描规划结合稳温策略，偏向保护料性。" }
      ],
      finishing: [
        { modelKey: "shuiheng-finishing-1", name: "冷抛基础线", modelName: "SH-F1 冷抛型", category: "玉雕机·抛光机", price: 10800, quality: 4, risk: 0.96, speed: 8, perfectFloor: 1, focus: "冷抛", description: "冷抛降低过热导致的细部损耗。" },
        { modelKey: "shuiheng-finishing-2", name: "恒温精修线", modelName: "SH-F2 恒温精修", category: "镶嵌机", price: 14400, quality: 5, risk: 0.90, speed: 7, perfectFloor: 2, focus: "恒温精修", description: "恒温收口，适合有镶嵌需求的中高价成品。" },
        { modelKey: "shuiheng-finishing-3", name: "水润高光线", modelName: "SH-F3 水润高光", category: "高光精雕机", price: 18200, quality: 7, risk: 0.92, speed: 6, perfectFloor: 3, focus: "润面高光", description: "高光面更润，但采购和维护成本都偏高。" }
      ]
    }
  },
  {
    brandKey: "gongzao",
    brand: "工造",
    code: "GZ",
    positioning: "主流均衡",
    priceTier: "标准",
    startingPrice: 9200,
    profile: "主流均衡：标准售价，属性无明显短板。",
    stages: {
      opening: [
        { modelKey: "gongzao-opening-1", name: "基础开料线", modelName: "GZ-O1 基础型", category: "打磨机", price: 9000, quality: 3, risk: 1.08, speed: 9, perfectFloor: 1, focus: "均衡入门", description: "可靠的基础开料型号，适合新工坊稳定补位。" },
        { modelKey: "gongzao-opening-2", name: "标准精磨线", modelName: "GZ-O2 标准型", category: "精磨机", price: 11800, quality: 4, risk: 1.00, speed: 10, perfectFloor: 1, focus: "标准均衡", description: "标准主力款，属性没有短板。" },
        { modelKey: "gongzao-opening-3", name: "加强水切线", modelName: "GZ-O3 加强型", category: "水床切片机", price: 14800, quality: 5, risk: 1.02, speed: 11, perfectFloor: 2, focus: "均衡加强", description: "开料阶段全能加强款，适合长期持有。" }
      ],
      carving: [
        { modelKey: "gongzao-carving-1", name: "基础套料线", modelName: "GZ-C1 基础套料", category: "套料机", price: 9600, quality: 3, risk: 1.08, speed: 9, perfectFloor: 1, focus: "基础套料", description: "基础规划取件线，便宜但不激进。" },
        { modelKey: "gongzao-carving-2", name: "标准取件线", modelName: "GZ-C2 标准取件", category: "取件机", price: 12600, quality: 4, risk: 1.00, speed: 10, perfectFloor: 1, focus: "标准取件", description: "标准取件机，适合大多数中档料。" },
        { modelKey: "gongzao-carving-3", name: "精准套取线", modelName: "GZ-C3 精准套取", category: "扫描设计台", price: 15800, quality: 5, risk: 1.02, speed: 10, perfectFloor: 2, focus: "精准均衡", description: "扫描与取件综合加强，兼顾速度和完美度。" }
      ],
      finishing: [
        { modelKey: "gongzao-finishing-1", name: "基础抛光线", modelName: "GZ-F1 基础抛光", category: "玉雕机·抛光机", price: 9400, quality: 3, risk: 1.08, speed: 9, perfectFloor: 1, focus: "基础抛光", description: "基础成品收口线，成本和风险都适中。" },
        { modelKey: "gongzao-finishing-2", name: "标准精修线", modelName: "GZ-F2 标准精修", category: "镶嵌机", price: 12400, quality: 4, risk: 1.00, speed: 10, perfectFloor: 1, focus: "标准精修", description: "均衡镶嵌与精修，适合常驻主力设备。" },
        { modelKey: "gongzao-finishing-3", name: "全能收口线", modelName: "GZ-F3 全能收口", category: "高光精雕机", price: 15600, quality: 5, risk: 1.02, speed: 10, perfectFloor: 2, focus: "全能收口", description: "综合能力加强，适合覆盖多种成品版式。" }
      ]
    }
  },
  {
    brandKey: "ruikong",
    brand: "瑞控",
    code: "RK",
    positioning: "自动化产能",
    priceTier: "高端",
    startingPrice: 16200,
    profile: "自动化产能：高售价、高速度和一致性。",
    stages: {
      opening: [
        { modelKey: "ruikong-opening-1", name: "自动打磨线", modelName: "RK-O1 自动打磨", category: "打磨机", price: 11600, quality: 4, risk: 1.02, speed: 12, perfectFloor: 1, focus: "自动打磨", description: "自动化入门款，速度优于传统设备。" },
        { modelKey: "ruikong-opening-2", name: "数控开料线", modelName: "RK-O2 数控开料", category: "精磨机", price: 15200, quality: 5, risk: 0.96, speed: 13, perfectFloor: 2, focus: "数控一致", description: "数控开料提高稳定性和节拍。" },
        { modelKey: "ruikong-opening-3", name: "高速联控线", modelName: "RK-O3 高速联控", category: "水床切片机", price: 19600, quality: 6, risk: 0.98, speed: 16, perfectFloor: 2, focus: "联控高速", description: "高价高速联控设备，适合追求稳定产能。" }
      ],
      carving: [
        { modelKey: "ruikong-carving-1", name: "数控套料线", modelName: "RK-C1 数控套料", category: "套料机", price: 12400, quality: 4, risk: 1.02, speed: 12, perfectFloor: 1, focus: "数控套料", description: "数控套料降低人为偏差，速度较快。" },
        { modelKey: "ruikong-carving-2", name: "自动取件线", modelName: "RK-C2 自动取件", category: "取件机", price: 16200, quality: 5, risk: 0.94, speed: 13, perfectFloor: 2, focus: "自动取件", description: "自动取件主力款，兼顾速度和一致性。" },
        { modelKey: "ruikong-carving-3", name: "联控规划线", modelName: "RK-C3 联控规划", category: "扫描设计台", price: 20800, quality: 6, risk: 0.96, speed: 15, perfectFloor: 2, focus: "联控规划", description: "高速联控扫描规划，适合规模化工坊。" }
      ],
      finishing: [
        { modelKey: "ruikong-finishing-1", name: "自动抛光线", modelName: "RK-F1 自动抛光", category: "玉雕机·抛光机", price: 12000, quality: 4, risk: 1.02, speed: 12, perfectFloor: 1, focus: "自动抛光", description: "自动抛光提高收尾节奏，适合稳定连续成品。" },
        { modelKey: "ruikong-finishing-2", name: "数控精修线", modelName: "RK-F2 数控精修", category: "镶嵌机", price: 16000, quality: 5, risk: 0.94, speed: 13, perfectFloor: 2, focus: "数控精修", description: "数控镶嵌和精修，提高成品一致性。" },
        { modelKey: "ruikong-finishing-3", name: "联控高光线", modelName: "RK-F3 联控高光", category: "高光精雕机", price: 20600, quality: 6, risk: 0.98, speed: 15, perfectFloor: 2, focus: "高光联控", description: "高价高产能收口设备，适合成熟工坊。" }
      ]
    }
  },
  {
    brandKey: "moxian",
    brand: "墨线",
    code: "MX",
    positioning: "规划专家",
    priceTier: "高端",
    startingPrice: 18400,
    profile: "规划专家：高端售价，扫描规划和保底强。",
    stages: {
      opening: [
        { modelKey: "moxian-opening-1", name: "标记开料线", modelName: "MX-O1 标记开料", category: "打磨机", price: 10800, quality: 5, risk: 1.00, speed: 7, perfectFloor: 2, focus: "标记开窗", description: "先标记再开料，提升开窗判断质量。" },
        { modelKey: "moxian-opening-2", name: "影像精磨线", modelName: "MX-O2 影像精磨", category: "精磨机", price: 14400, quality: 6, risk: 0.96, speed: 6, perfectFloor: 3, focus: "影像精磨", description: "影像辅助精磨，提升料性识别和完美度下限。" },
        { modelKey: "moxian-opening-3", name: "扫描开窗线", modelName: "MX-O3 扫描开窗", category: "水床切片机", price: 18400, quality: 7, risk: 0.98, speed: 6, perfectFloor: 3, focus: "扫描开窗", description: "开料前扫描建模，适合高价值暗料的谨慎处理。" }
      ],
      carving: [
        { modelKey: "moxian-carving-1", name: "线稿套料线", modelName: "MX-C1 线稿套料", category: "套料机", price: 11600, quality: 5, risk: 0.98, speed: 7, perfectFloor: 2, focus: "线稿套料", description: "线稿辅助套料，提升基础规划质量。" },
        { modelKey: "moxian-carving-2", name: "影像取件线", modelName: "MX-C2 影像取件", category: "取件机", price: 15400, quality: 6, risk: 0.94, speed: 6, perfectFloor: 3, focus: "影像取件", description: "影像辅助取件，适合边界复杂的套件。" },
        { modelKey: "moxian-carving-3", name: "三维扫描线", modelName: "MX-C3 三维扫描", category: "扫描设计台", price: 19800, quality: 8, risk: 0.96, speed: 5, perfectFloor: 4, focus: "三维规划", description: "规划阶段强势型号，提高复杂料的方案质量。" }
      ],
      finishing: [
        { modelKey: "moxian-finishing-1", name: "线控抛光线", modelName: "MX-F1 线控抛光", category: "玉雕机·抛光机", price: 11200, quality: 5, risk: 1.00, speed: 7, perfectFloor: 2, focus: "线控抛光", description: "按设计线控抛光，减少收尾偏差。" },
        { modelKey: "moxian-finishing-2", name: "影像精修线", modelName: "MX-F2 影像精修", category: "镶嵌机", price: 15000, quality: 6, risk: 0.96, speed: 6, perfectFloor: 3, focus: "影像精修", description: "影像辅助细部修整，提高镶嵌一致性。" },
        { modelKey: "moxian-finishing-3", name: "曲面高光线", modelName: "MX-F3 曲面高光", category: "高光精雕机", price: 19200, quality: 8, risk: 0.98, speed: 5, perfectFloor: 4, focus: "曲面高光", description: "对复杂曲面更友好，适合高审美成品。" }
      ]
    }
  },
  {
    brandKey: "zhuoguang",
    brand: "琢光",
    code: "ZG",
    positioning: "出光精修",
    priceTier: "高端",
    startingPrice: 14400,
    profile: "出光精修：高端售价，精加工品质强。",
    stages: {
      opening: [
        { modelKey: "zhuoguang-opening-1", name: "光面预磨线", modelName: "ZG-O1 光面预磨", category: "打磨机", price: 10000, quality: 4, risk: 1.04, speed: 8, perfectFloor: 1, focus: "光面预磨", description: "开料阶段先做光面预处理，便于后续出光。" },
        { modelKey: "zhuoguang-opening-2", name: "细磨开料线", modelName: "ZG-O2 细磨开料", category: "精磨机", price: 13400, quality: 5, risk: 1.00, speed: 7, perfectFloor: 2, focus: "细磨开料", description: "开料不追极限速度，更注重细磨质感。" },
        { modelKey: "zhuoguang-opening-3", name: "亮面水磨线", modelName: "ZG-O3 亮面水磨", category: "水床切片机", price: 17000, quality: 6, risk: 1.02, speed: 7, perfectFloor: 2, focus: "亮面基础", description: "为后续精加工建立更好的光面基础。" }
      ],
      carving: [
        { modelKey: "zhuoguang-carving-1", name: "光线套料线", modelName: "ZG-C1 光线套料", category: "套料机", price: 10800, quality: 4, risk: 1.04, speed: 8, perfectFloor: 1, focus: "光线套料", description: "套料时更关注出光方向，适合成品导向生产。" },
        { modelKey: "zhuoguang-carving-2", name: "细雕取件线", modelName: "ZG-C2 细雕取件", category: "取件机", price: 14400, quality: 6, risk: 1.00, speed: 7, perfectFloor: 2, focus: "细雕取件", description: "取件质量更高，速度中等。" },
        { modelKey: "zhuoguang-carving-3", name: "曲面雕刻线", modelName: "ZG-C3 曲面雕刻", category: "扫描设计台", price: 18400, quality: 7, risk: 1.02, speed: 6, perfectFloor: 3, focus: "曲面雕刻", description: "规划更偏曲面美感，为高光精修铺路。" }
      ],
      finishing: [
        { modelKey: "zhuoguang-finishing-1", name: "亮抛收光线", modelName: "ZG-F1 亮抛型", category: "玉雕机·抛光机", price: 11800, quality: 5, risk: 1.06, speed: 8, perfectFloor: 1, focus: "亮抛", description: "精加工基础强势款，适合提升常规成品光感。" },
        { modelKey: "zhuoguang-finishing-2", name: "精光镶嵌线", modelName: "ZG-F2 精光型", category: "镶嵌机", price: 15800, quality: 7, risk: 1.02, speed: 7, perfectFloor: 2, focus: "精光镶嵌", description: "镶嵌与出光兼顾，适合中高档成品。" },
        { modelKey: "zhuoguang-finishing-3", name: "高光精雕线", modelName: "ZG-F3 高光精雕", category: "高光精雕机", price: 21400, quality: 9, risk: 1.08, speed: 6, perfectFloor: 3, focus: "高光精雕", description: "品牌旗舰高光型号，追求成品表现上限。" }
      ]
    }
  },
  {
    brandKey: "jingong",
    brand: "金工",
    code: "JG",
    positioning: "精品镶嵌",
    priceTier: "顶级",
    startingPrice: 21000,
    profile: "精品镶嵌：顶级售价，成品收口和保底最强。",
    stages: {
      opening: [
        { modelKey: "jingong-opening-1", name: "包边预磨线", modelName: "JG-O1 包边预磨", category: "打磨机", price: 12200, quality: 5, risk: 0.98, speed: 6, perfectFloor: 2, focus: "镶前预磨", description: "为后续镶嵌预留边位，开料节奏较慢。" },
        { modelKey: "jingong-opening-2", name: "托位开料线", modelName: "JG-O2 托位开料", category: "精磨机", price: 16200, quality: 6, risk: 0.94, speed: 5, perfectFloor: 3, focus: "托位开料", description: "开料时兼顾托位需求，适合精品路线。" },
        { modelKey: "jingong-opening-3", name: "镶前净料线", modelName: "JG-O3 镶前净料", category: "水床切片机", price: 20800, quality: 7, risk: 0.96, speed: 5, perfectFloor: 3, focus: "镶前净料", description: "高价开料型号，为最终镶嵌留出更好基础。" }
      ],
      carving: [
        { modelKey: "jingong-carving-1", name: "托位套料线", modelName: "JG-C1 托位套料", category: "套料机", price: 13200, quality: 5, risk: 0.98, speed: 6, perfectFloor: 2, focus: "托位套料", description: "套料时预留托位和包边空间。" },
        { modelKey: "jingong-carving-2", name: "镶位取件线", modelName: "JG-C2 镶位取件", category: "取件机", price: 17600, quality: 6, risk: 0.94, speed: 5, perfectFloor: 3, focus: "镶位取件", description: "取件更适合镶嵌成品，速度偏慢。" },
        { modelKey: "jingong-carving-3", name: "微镶规划线", modelName: "JG-C3 微镶规划", category: "扫描设计台", price: 22400, quality: 8, risk: 0.96, speed: 4, perfectFloor: 4, focus: "微镶规划", description: "为复杂镶嵌件规划位置，偏向高价精品。" }
      ],
      finishing: [
        { modelKey: "jingong-finishing-1", name: "镶嵌基础线", modelName: "JG-F1 镶嵌基础", category: "玉雕机·抛光机", price: 13800, quality: 5, risk: 0.98, speed: 6, perfectFloor: 2, focus: "镶嵌基础", description: "基础镶嵌和抛光一体，适合入门精品线。" },
        { modelKey: "jingong-finishing-2", name: "镶嵌一体线", modelName: "JG-F2 镶嵌一体", category: "镶嵌机", price: 18800, quality: 7, risk: 0.94, speed: 5, perfectFloor: 3, focus: "镶嵌一体", description: "品牌主力镶嵌型号，稳定提高成品质感。" },
        { modelKey: "jingong-finishing-3", name: "高级收口线", modelName: "JG-F3 高级收口", category: "高光精雕机", price: 23800, quality: 10, risk: 0.98, speed: 4, perfectFloor: 5, focus: "高级收口", description: "昂贵旗舰收口设备，品质和保底都很高。" }
      ]
    }
  }
];

const STAGE_PRICE_MULTIPLIERS = {
  opening: 1,
  carving: 1.15,
  finishing: 1.3
};

export const MODEL_TECH_PRICE_MULTIPLIERS = Object.freeze([1, 3.0, 8.0]);

export const MODEL_TECH_ATTR_BONUSES = Object.freeze([
  Object.freeze({ quality: 0, speed: 0, perfectFloor: 0, riskSafety: 0 }),
  Object.freeze({ quality: 6, speed: 15, perfectFloor: 12, riskSafety: 0.05 }),
  Object.freeze({ quality: 18, speed: 32, perfectFloor: 30, riskSafety: 0.12 })
]);

function roundEquipmentPrice(value) {
  return Math.round(Number(value || 0) / 100) * 100;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function roundEquipmentAttr(value, decimals = 0) {
  const scale = 10 ** decimals;
  return Math.round(Number(value || 0) * scale) / scale;
}

function modelPrice(line, stage, modelIndex) {
  return roundEquipmentPrice(
    Number(line.startingPrice || 0)
      * Number(STAGE_PRICE_MULTIPLIERS[stage] || 1)
      * Number(MODEL_TECH_PRICE_MULTIPLIERS[modelIndex] || 1)
  );
}

function modelAttrs(row, modelIndex) {
  const bonus = MODEL_TECH_ATTR_BONUSES[modelIndex] || MODEL_TECH_ATTR_BONUSES[0];
  return {
    quality: roundEquipmentAttr(clampNumber(Number(row.quality || 0) + bonus.quality, 0, 55)),
    risk: roundEquipmentAttr(clampNumber(Number(row.risk || 1) - bonus.riskSafety, 0.62, 1.35), 2),
    speed: roundEquipmentAttr(clampNumber(Number(row.speed || 0) + bonus.speed, 0, 78)),
    perfectFloor: roundEquipmentAttr(clampNumber(Number(row.perfectFloor || 0) + bonus.perfectFloor, 0, 72))
  };
}

const ROUTES = {
  opening: {
    inputType: "rough",
    inputStage: "rough",
    outputStage: "opened",
    durationStage: "rough",
    workerId: "worker-opening",
    fee: 620,
    needsKits: false
  },
  carving: {
    inputType: "rough",
    inputStage: "opened",
    outputStage: "carved",
    durationStage: "refine",
    workerId: "worker-polishing",
    fee: 900,
    needsKits: true
  },
  finishing: {
    inputType: "bracelet",
    inputStage: "carved",
    outputStage: "finished",
    durationStage: "inlay",
    workerId: "worker-carving",
    fee: 680,
    needsKits: false
  }
};

const EQUIPMENT_CATALOG = Object.freeze(
  [
    ...[ ["opening", 3200, "旧式开料台", "JS-O1", "打磨机"],
      ["carving", 4600, "旧式取件台", "JS-C1", "套料机"],
      ["finishing", 6200, "旧式精加工台", "JS-F1", "玉雕机·抛光机"] ].map(([stage, price, name, modelName, category]) => Object.freeze({
      modelKey: `used-${stage}-1`, stage, price, name, modelName, category,
      quality: 0.5, risk: 1, speed: 0, perfectFloor: 0,
      valueBonusCap: Math.round(price * 0.02),
      brandKey: "used", brand: "街坊旧机", brandCode: "JS", brandPositioning: "起步自营",
      brandPriceTier: "入门旧机", brandBasePrice: 3200, brandPeakPrice: 6200,
      techLevel: 1, tier: 1, model: `街坊旧机 ${modelName}`,
      displayName: deviceInstanceName(name, "街坊旧机", modelName, category),
      focus: "低成本自营", profile: "低价耐用，效率与工艺加值较低；维修按实际损耗计费。",
      description: "适合从公共工位起步后逐台购入，自营节省工位费用，后续可换购标准设备。"
    })),
    ...BRAND_LINES.flatMap((line) =>
    Object.entries(line.stages).flatMap(([stage, rows]) =>
      rows.map((row, modelIndex) => {
        const attrs = modelAttrs(row, modelIndex);
        return Object.freeze({
          ...row,
          ...attrs,
          price: modelPrice(line, stage, modelIndex),
          valueBonusCap: Math.round(modelPrice(line, stage, modelIndex) * 0.02),
          stage,
          brandKey: line.brandKey,
          brand: line.brand,
          brandCode: line.code,
          brandPositioning: line.positioning,
          brandPriceTier: line.priceTier,
          brandBasePrice: line.startingPrice,
          brandPeakPrice: modelPrice(line, "finishing", 2),
          techLevel: modelIndex + 1,
          profile: line.profile,
          tier: 1,
          model: `${line.brand} ${row.modelName}`,
          displayName: deviceInstanceName(row.name, line.brand, row.modelName, row.category)
        });
      })
    )
    )
  ]
);

export function equipmentCatalog() {
  return EQUIPMENT_CATALOG.map((row) => ({ ...row }));
}

const LEGACY_MODEL_KEYS = {
  rough: "cuijie-opening-1",
  refine: "wenyu-opening-2",
  waterbed: "shuiheng-opening-3",
  carve: "gongzao-carving-1",
  cnc: "ruikong-carving-2",
  scan3d: "moxian-carving-3",
  polish: "zhuoguang-finishing-1",
  inlay: "jingong-finishing-2",
  hiperf: "zhuoguang-finishing-3"
};

const LEGACY_BASE_NAMES = new Set([
  "粗加工台",
  "精磨台",
  "水床切片机",
  "套件雕刻台",
  "数控取件台",
  "3D扫描设计台",
  "精加工抛光台",
  "镶嵌一体机",
  "高光精雕机"
]);

const LEGACY_DISPLAY_NAMES = new Set([
  "翠捷牌CJ-1 基础型打磨机",
  "稳玉牌JM-2 稳型精磨机",
  "水衡牌WB-3水床机",
  "工造牌SK-2套料机",
  "瑞控牌NC-4取件机",
  "墨线牌SD-5扫描设计台",
  "琢光牌JP-3玉雕机·抛光机",
  "金工牌IJ-6镶嵌机",
  "曜刻牌HG-7高光精雕机"
]);

const LEGACY_NAME_VARIANTS = [
  "稳手",
  "青峰",
  "晨光",
  "银线",
  "长青",
  "匠心",
  "水月",
  "云纹",
  "明砂",
  "岚光",
  "静磨",
  "金线",
  "石脉",
  "圆光",
  "正锋",
  "清润"
];

function escapeRegExp(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deviceInstanceName(baseName, brand = "", modelName = "", category = "") {
  const brandPrefix = brand ? `${brand}牌` : "";
  const machineName = `${modelName || ""}${category || baseName}`;
  return `${brandPrefix}${machineName}`;
}

function canonicalModelKey(modelKey = "") {
  const key = String(modelKey || "");
  return LEGACY_MODEL_KEYS[key] || key;
}

function findEquipmentModel(stage, modelKey) {
  const key = canonicalModelKey(modelKey);
  return EQUIPMENT_CATALOG.find((entry) => entry.modelKey === key && (!stage || entry.stage === stage))
    || EQUIPMENT_CATALOG.find((entry) => entry.modelKey === key)
    || null;
}

function generatedNameCandidates(model, baseName) {
  return [
    baseName,
    model?.name,
    model?.displayName,
    model?.brand && baseName ? `${model.brand}牌${baseName}` : "",
    model?.brand && model?.name ? `${model.brand}牌${model.name}` : ""
  ].filter(Boolean);
}

function isGeneratedEquipmentName(existingName, model, baseName, device = {}) {
  const name = String(existingName || "").trim();
  if (!name) return true;
  if (LEGACY_BASE_NAMES.has(name) || LEGACY_DISPLAY_NAMES.has(name)) return true;
  if (generatedNameCandidates(model, baseName).includes(name)) return true;

  const legacyVariantNames = LEGACY_NAME_VARIANTS.map(escapeRegExp).join("|");
  const baseNames = [...new Set([baseName, model?.name].filter(Boolean))];
  const escapedBrand = escapeRegExp(model?.brand || "");
  for (const candidate of baseNames) {
    const escapedBaseName = escapeRegExp(candidate);
    const legacyIndexedName = new RegExp(`^(?:${escapedBrand}牌)?${escapedBaseName} \\d+号$`);
    const generatedBaseName = new RegExp(`^(?:${escapedBrand}牌)?(?:${legacyVariantNames})?${escapedBaseName}$`);
    if (legacyIndexedName.test(name) || generatedBaseName.test(name)) return true;
  }

  if (model?.brand && model?.category) {
    const generatedModelName = new RegExp(`^${escapedBrand}牌(?:${legacyVariantNames})?\\s*.+${escapeRegExp(model.category)}$`);
    if (generatedModelName.test(name)) return true;
  }

  return Boolean(device?.nameVariant && baseNames.some((candidate) => name.includes(candidate)));
}

function sameModel(left, right) {
  return left?.stage === right?.stage && canonicalModelKey(left?.modelKey) === canonicalModelKey(right?.modelKey);
}

function nextInstanceIndex(player, model) {
  const devices = player?.workshop?.devices || [];
  return devices.filter((device) => sameModel(device, model)).length + 1;
}

export function createDeviceInstance(stage, modelKey, id, options = {}) {
  const model = findEquipmentModel(stage, modelKey);
  if (!model) return null;
  const instanceIndex = Math.max(1, Math.round(Number(options.instanceIndex) || 1));
  const baseAttrs = {
    quality: model.quality,
    risk: model.risk,
    speed: model.speed,
    perfectFloor: model.perfectFloor,
    valueBonusCap: model.valueBonusCap
  };
  return {
    id,
    stage: model.stage,
    modelKey: model.modelKey,
    name: options.name || model.displayName,
    baseName: model.name,
    brandKey: model.brandKey,
    brand: model.brand,
    brandCode: model.brandCode,
    brandPositioning: model.brandPositioning,
    brandPriceTier: model.brandPriceTier,
    brandBasePrice: model.brandBasePrice,
    brandPeakPrice: model.brandPeakPrice,
    category: model.category,
    model: model.model,
    modelName: model.modelName,
    displayName: model.displayName,
    focus: model.focus,
    description: model.description,
    profile: model.profile,
    techLevel: model.techLevel,
    instanceIndex,
    tier: 1,
    basePrice: model.price,
    baseAttrs,
    attrs: { ...baseAttrs },
    ...ROUTES[model.stage],
    capacity: 1,
    condition: 100,
    specs: `品质+${model.quality}%（每步加值≤${model.valueBonusCap}） · 风险×${model.risk} · 速度+${model.speed}% · 保底${model.perfectFloor}%`
  };
}

export function normalizeDevice(device) {
  const model = findEquipmentModel(device?.stage, device?.modelKey);
  const canonical = model
    ? createDeviceInstance(model.stage, model.modelKey, device?.id, { instanceIndex: device?.instanceIndex })
    : {};
  const baseName = model?.name || device?.baseName || device?.name || canonical.baseName;
  const existingName = String(device?.name || "").trim();
  const useDisplayName = Boolean(model && isGeneratedEquipmentName(existingName, model, baseName, device));
  return {
    ...canonical,
    ...device,
    id: device?.id,
    stage: model?.stage || device?.stage,
    modelKey: model?.modelKey || device?.modelKey,
    baseName,
    brandKey: model?.brandKey || device?.brandKey,
    brand: model?.brand || device?.brand,
    brandCode: model?.brandCode || device?.brandCode,
    brandPositioning: model?.brandPositioning || device?.brandPositioning,
    brandPriceTier: model?.brandPriceTier || device?.brandPriceTier,
    brandBasePrice: model?.brandBasePrice || device?.brandBasePrice,
    brandPeakPrice: model?.brandPeakPrice || device?.brandPeakPrice,
    category: model?.category || device?.category,
    modelName: model?.modelName || device?.modelName,
    model: model?.model || device?.model,
    displayName: model?.displayName || device?.displayName,
    focus: model?.focus || device?.focus,
    description: model?.description || device?.description,
    profile: model?.profile || device?.profile,
    techLevel: model?.techLevel || device?.techLevel,
    name: useDisplayName
      ? model.displayName
      : existingName || canonical.name || deviceInstanceName(baseName, model?.brand || device?.brand, model?.modelName || device?.modelName, model?.category || device?.category),
    nameVariant: undefined,
    tier: 1,
    basePrice: Number(model?.price || device?.basePrice || 0),
    baseAttrs: {
      ...(canonical.baseAttrs || {}),
      ...(model ? {} : (device?.baseAttrs || {}))
    },
    attrs: {
      ...(canonical.attrs || {}),
      ...(model ? {} : (device?.attrs || {}))
    },
    specs: model ? canonical.specs : (device?.specs || canonical.specs),
    capacity: 1,
    condition: Math.max(0, Math.min(100, Number(device?.condition ?? 100)))
  };
}

export function normalizeDevices(devices = []) {
  const counters = new Map();
  return devices.map((device) => {
    const normalized = normalizeDevice(device);
    const key = `${normalized.stage || "unknown"}:${normalized.modelKey || "unknown"}`;
    const nextIndex = (counters.get(key) || 0) + 1;
    counters.set(key, nextIndex);
    const baseName = normalized.baseName || normalized.name || "加工设备";
    const existingName = String(normalized.name || "").trim();
    const model = findEquipmentModel(normalized.stage, normalized.modelKey);
    const isGenericName = Boolean(model && isGeneratedEquipmentName(existingName, model, baseName, normalized));
    const instanceIndex = isGenericName
      ? nextIndex
      : Math.max(1, Math.round(Number(normalized.instanceIndex) || nextIndex));
    return {
      ...normalized,
      instanceIndex,
      nameVariant: undefined,
      name: isGenericName
        ? model.displayName
        : existingName
    };
  });
}

export function durabilityLoss(device) {
  const risk = Number(device?.attrs?.risk ?? 1);
  return Math.max(1, Math.min(3, Math.round(1 + Math.max(0, risk - 1) * 5)));
}

export function repairQuote(device) {
  return equipmentRepairQuote(device);
}

export function buyEquipment(player, modelKey, { spendCash, makeId }) {
  const model = findEquipmentModel(null, modelKey);
  if (!model) {
    return { ok: false, code: "NOT_FOUND", message: "设备型号不存在。" };
  }
  const instanceIndex = nextInstanceIndex(player, model);
  player.workshop ||= {};
  player.workshop.devices ||= [];
  const deviceId = typeof makeId === "function" ? String(makeId() || "").trim() : "";
  if (!deviceId || player.workshop.devices.some((device) => String(device?.id || "") === deviceId)) {
    return {
      ok: false,
      code: "ID_CONFLICT",
      message: "设备编号冲突，本次购买未扣款，请重试。"
    };
  }
  if (!spendCash(
    player,
    model.price,
    `购入设备：${model.displayName}`,
    { source: "equipment", itemId: model.modelKey }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `购买 ${model.displayName} 需要 ¥${model.price}。`
    };
  }
  const device = createDeviceInstance(model.stage, model.modelKey, deviceId, {
    instanceIndex
  });
  if (!(player.workshop.workers || []).some((worker) => worker.id === device.workerId)) device.workerId = OWNER_OPERATOR_ID;
  device.resourceOrigin = "shop";
  device.acquisitionPrice = model.price;
  device.acquiredAt = Date.now();
  player.workshop.devices.push(device);
  return { ok: true, message: `${model.displayName} 已加入工坊。`, device };
}

export function repairEquipment(player, deviceId, { spendCash }) {
  const device = player?.workshop?.devices?.find((item) => item.id === deviceId);
  if (!device) {
    return { ok: false, code: "NOT_FOUND", message: "设备不存在。" };
  }
  const busy = [...(player.jobs || []), ...(player.polishingJobs || [])]
    .some((job) => job?.deviceId === deviceId)
    || (Array.isArray(player.commissions?.active?.deviceIds) && player.commissions.active.deviceIds.includes(deviceId));
  if (busy) return { ok: false, code: "DEVICE_BUSY", message: "设备正在加工或执行来料单，完成后再维修。" };
  const cost = repairQuote(device);
  if (device.blackmarketListingId) return { ok: false, code: "RESOURCE_LISTED", message: "设备正在黑市挂牌，请先撤回再维修。" };
  if (cost === 0) {
    return { ok: false, code: "INVALID_QUANTITY", message: "设备无需维修。" };
  }
  if (!spendCash(
    player,
    cost,
    `维修设备：${device.name}`,
    { source: "equipmentRepair", itemId: device.id }
  )) {
    return {
      ok: false,
      code: "INSUFFICIENT_CASH",
      message: `维修需要 ¥${cost}。`
    };
  }
  device.condition = 100;
  return { ok: true, message: `${device.name} 已维修至 100%。`, device, cost };
}
