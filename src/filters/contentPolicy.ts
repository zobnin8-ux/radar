import type { NewsItem } from "../types.js";

export interface ContentPolicyResult {
  allowedForRadar: boolean;
  reason: string;
}

export interface ContentPolicyFilterResult {
  passed: NewsItem[];
  rejected: { item: NewsItem; result: ContentPolicyResult }[];
}

type PatternRule = {
  id: string;
  reason: string;
  pattern: RegExp;
};

function itemText(item: NewsItem): string {
  return `${item.title} ${item.description ?? ""} ${item.url}`.trim();
}

/** Явный гражданский контекст — разрешает dual-use темы */
const CIVILIAN_CONTEXT =
  /\b(warehouse|logistics\s+robot|medical\s+robot|surgical\s+robot|healthcare\s+robot|mars\s+rover|lunar\s+rover|space\s+telescope|james\s+webb|hubble|cosmic\s+research|fundamental\s+research|scientific\s+research|laboratory\s+experiment|arxiv|peer[- ]reviewed|battery\s+technology|solid[- ]state\s+battery|fusion\s+energy|solar\s+cell|hydrogen\s+energy|electric\s+vehicle|self[- ]driving\s+car|autonomous\s+delivery|autonomous\s+truck|civilian\s+satellite|weather\s+satellite|communication\s+satellite|starlink\s+internet|3d[- ]print|bioprint|crispr|genome\s+sequencing|materials?\s+science|semiconductor\s+manufacturing|chip\s+fabrication|ai\s+for\s+science|ai\s+assistant|language\s+model|llm\s+for|open[- ]source\s+model|robotic\s+arm\s+for\s+manufacturing|industrial\s+automation|exoskeleton\s+for\s+rehab|prosthetic|clean\s+energy|renewable\s+energy|climate\s+model|telescope|accelerator\s+physics|quantum\s+computing|neuromorphic)\b/i;

const CIVILIAN_CONTEXT_RU =
  /(складск|медицинск\w*\s+робот|хирургическ\w*\s+робот|космическ\w*\s+телескоп|научн\w*\s+исследован|лабораторн\w*\s+эксперимент|академи\w*\s+наук|электромобил|автономн\w*\s+доставк|гражданск\w*\s+спутник|метеоспутник|солнечн\w*\s+батаре|термоядерн\w*\s+синтез|полупроводник|нейросет|языков\w*\s+модел|квантов\w*\s+вычисл|биотехнолог|геном|материаловед)/i;

function hasCivilianContext(text: string): boolean {
  return CIVILIAN_CONTEXT.test(text) || CIVILIAN_CONTEXT_RU.test(text);
}

const POLITICS: PatternRule[] = [
  { id: "elections", reason: "Politics: elections", pattern: /\b(election|elections|ballot|vote\s+count|polling\s+station|primary\s+election|general\s+election)\b/i },
  { id: "elections_ru", reason: "Politics: elections", pattern: /(выборы|избирательн|голосовани\w*\s+на\s+выборах)/i },
  { id: "parties", reason: "Politics: political parties", pattern: /\b(political\s+party|parliament|congress\s+vote|senate\s+vote|house\s+of\s+representatives|legislative\s+bill|government\s+shutdown)\b/i },
  { id: "parties_ru", reason: "Politics: state policy", pattern: /(политическ\w*\s+парт|парламент|госдум|законопроект|правительств\w*\s+утверд)/i },
  { id: "sanctions", reason: "Geopolitics: sanctions", pattern: /\b(sanctions?\s+against|economic\s+sanctions|trade\s+embargo|export\s+ban)\b/i },
  { id: "sanctions_ru", reason: "Geopolitics: sanctions", pattern: /(санкци|эмбарго|геополитик)/i },
  { id: "conflict", reason: "Geopolitics: conflict", pattern: /\b(war\s+in|armed\s+conflict|ceasefire|invasion|airstrike\s+on|frontline|geopolitical\s+tension|military\s+conflict)\b/i },
  { id: "conflict_ru", reason: "Geopolitics: conflict", pattern: /(военн\w*\s+конфликт|перемири|фронт(а|е|у)|вторжени|геополитик|спецопераци)/i },
  { id: "diplomacy", reason: "Politics: diplomacy", pattern: /\b(diplomatic\s+talks|foreign\s+ministry\s+says|state\s+department\s+says|summit\s+meeting|bilateral\s+talks)\b/i },
  { id: "leaders", reason: "Politics: political leaders", pattern: /\b(trump\s+says|biden\s+says|putin\s+says|zelensky\s+says|white\s+house\s+says|kremlin\s+says)\b/i },
  { id: "protests", reason: "Politics: protests", pattern: /\b(protest\s+march|rally\s+against|demonstrators\s+clash|mass\s+protest)\b/i },
  { id: "protests_ru", reason: "Politics: protests", pattern: /(протест|митинг|демонстраци\w*\s+против)/i },
  { id: "propaganda_ru", reason: "Politics: propaganda", pattern: /(государственн\w*\s+пропаганд|идеологическ\w*\s+тем|пропаганд\w*\s+кампани)/i },
  { id: "gov_regulation_ru", reason: "Politics: state regulation", pattern: /(госрегулирован|роскомнадзор|ркн\s|блокировк\w*\s+ресурс|цензур\w*\s+интернет)/i },
  { id: "security_services_ru", reason: "Security services", pattern: /(фсб|фсо|росгварди|силов\w*\s+структур|спецслужб)/i },
  { id: "gov_officials_ru", reason: "Politics: government officials", pattern: /(министр\s+\w+\s+(заявил|сообщил)|вице-премьер|губернатор\s+\w+\s+подписал)/i },
];

const MILITARY: PatternRule[] = [
  { id: "military", reason: "Military: armed forces", pattern: /\b(armed\s+forces|military\s+operation|military\s+exercise|war\s+game|troops\s+deployed|pentagon|defense\s+ministry|ministry\s+of\s+defence|nato\s+forces|army\s+unit|navy\s+fleet|air\s+force\s+squadron)\b/i },
  { id: "military_ru", reason: "Military: armed forces", pattern: /(вооружённ\w*\s+сил|военн\w*\s+операци|военн\w*\s+учени|минобороны|министерств\w*\s+обороны|арми\w*|флот\w*\s+отправ|вс\s+рф)/i },
  { id: "defense_programs", reason: "Military: defense programs", pattern: /\b(defense\s+contract|defence\s+contract|military\s+procurement|arms\s+deal|defense\s+spending|military\s+budget)\b/i },
  { id: "defense_programs_ru", reason: "Military: defense programs", pattern: /(оборонн\w*\s+(заказ|контракт|програм)|военн\w*\s+закупк|гособоронзаказ|оборонк)/i },
  { id: "military_aviation_ru", reason: "Military: military aviation", pattern: /(военн\w*\s+авиаци|истребител\w*\s+пятого\s+поколени|ударн\w*\s+вертолёт)/i },
];

const WEAPONS: PatternRule[] = [
  { id: "missiles", reason: "Weapons: missiles", pattern: /\b(ballistic\s+missile|cruise\s+missile|hypersonic\s+weapon|missile\s+strike|icbm|nuclear\s+warhead)\b/i },
  { id: "missiles_ru", reason: "Weapons: missiles", pattern: /(баллистическ\w*\s+ракет|крылат\w*\s+ракет|гиперзвуков\w*\s+оружи|ядерн\w*\s+(боеголовк|оружи))/i },
  { id: "drones_strike", reason: "Weapons: combat drones", pattern: /\b(kamikaze\s+drone|strike\s+drone|attack\s+drone|loitering\s+munition|military\s+drone|combat\s+uav|killer\s+drone)\b/i },
  { id: "drones_strike_ru", reason: "Weapons: combat drones", pattern: /(ударн\w*\s+(дрон|бпла)|боев\w*\s+(дрон|бпла)|камикадзе[- ]дрон)/i },
  { id: "armor", reason: "Weapons: armor and artillery", pattern: /\b(battle\s+tank|main\s+battle\s+tank|artillery\s+barrage|howitzer|armored\s+vehicle\s+convoy)\b/i },
  { id: "naval_combat", reason: "Weapons: naval weapons", pattern: /\b(warship\s+deployment|naval\s+strike|submarine\s+patrol|nuclear\s+submarine|carrier\s+strike\s+group)\b/i },
  { id: "naval_combat_ru", reason: "Weapons: naval weapons", pattern: /(боев\w*\s+корабл|атомн\w*\s+подводн\w*\s+лодк|подлодк\w*\s+для\s+охоты|военн\w*\s+флот)/i },
  { id: "air_defense", reason: "Weapons: air/missile defense", pattern: /\b(air\s+defense\s+system|missile\s+defense|patriot\s+missile|iron\s+dome|s-400|s-500|thaad)\b/i },
  { id: "air_defense_ru", reason: "Weapons: air/missile defense", pattern: /(пво|противоракет|зенитн\w*\s+комплекс|с-400|с-500|патриот)/i },
  { id: "small_arms", reason: "Weapons: firearms and ammo", pattern: /\b(assault\s+rifle|ammunition\s+depot|small\s+arms\s+shipment|firearms\s+deal)\b/i },
  { id: "laser_weapon", reason: "Weapons: laser weapons", pattern: /\b(laser\s+weapon|directed[- ]energy\s+weapon)\b/i },
  { id: "weapons_ru", reason: "Weapons", pattern: /(вооружени|боеприпас|стрелков\w*\s+оружи|артиллери\w*\s+систем)/i },
  { id: "military_drones_ru", reason: "Weapons: military drones", pattern: /(военн\w*\s+(дрон|бпла)|разведывательн\w*\s+бпла)/i },
];

/** Dual-use: военный контекст — блокировать без гражданского сигнала */
const DUAL_USE_MILITARY: PatternRule[] = [
  { id: "mil_space", reason: "Military dual-use: military space", pattern: /\b(military\s+satellite|reconnaissance\s+satellite|spy\s+satellite|surveillance\s+satellite|antisatellite|anti-satellite)\b/i },
  { id: "mil_space_ru", reason: "Military dual-use: military space", pattern: /(военн\w*\s+спутник|разведывательн\w*\s+спутник|спутник.*разведк|противоспутник)/i },
  { id: "mil_ai", reason: "Military dual-use: military AI", pattern: /\b(military\s+ai|autonomous\s+weapon|lethal\s+autonomous|ai[- ]powered\s+warfare|battlefield\s+ai)\b/i },
  { id: "mil_ai_ru", reason: "Military dual-use: military AI", pattern: /(военн\w*\s+ии|автономн\w*\s+оружи|боев\w*\s+ии|применени\w*\s+ии.*арми)/i },
  { id: "mil_robot", reason: "Military dual-use: combat robots", pattern: /\b(military\s+robot|combat\s+robot|battlefield\s+robot|armed\s+robot|robot\s+soldier)\b/i },
  { id: "mil_robot_ru", reason: "Military dual-use: combat robots", pattern: /(боев\w*\s+робот|военн\w*\s+робот|робот.*солдат)/i },
  {
    id: "sub_hunter",
    reason: "Military dual-use: submarine detection",
    pattern: /\b(hunt\w*\s+(nuclear\s+)?submarines?|submarine\s+hunter|anti[- ]submarine\s+warfare)\b/i,
  },
  { id: "sub_hunter_ru", reason: "Military dual-use: submarine detection", pattern: /(охот\w*\s+на\s+(подводн|атомн)|противолодочн|детектир\w*\s+подводн\w*\s+лодк)/i },
  { id: "defense_tech", reason: "Military dual-use: defense R&D", pattern: /\b(defense\s+tech|defence\s+tech|military\s+technology|military\s+r&d|weapons\s+program)\b/i },
  { id: "defense_tech_ru", reason: "Military dual-use: defense R&D", pattern: /(оборонн\w*\s+технолог|военн\w*\s+технолог|военн\w*\s+разработк)/i },
  { id: "generic_drone_mil", reason: "Military dual-use: drone in conflict context", pattern: /\b(drone\s+strike|uav\s+strike|swarm\s+drone\s+attack)\b/i },
];

function matchRules(text: string, rules: PatternRule[]): PatternRule | null {
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule;
  }
  return null;
}

/**
 * Проверка политики контента «Радар будущего».
 * Имеет приоритет над остальными правилами отбора.
 */
export function checkContentPolicy(item: NewsItem): ContentPolicyResult {
  const text = itemText(item);

  const politics = matchRules(text, POLITICS);
  if (politics) {
    return { allowedForRadar: false, reason: politics.reason };
  }

  const military = matchRules(text, MILITARY);
  if (military) {
    return { allowedForRadar: false, reason: military.reason };
  }

  const weapons = matchRules(text, WEAPONS);
  if (weapons) {
    return { allowedForRadar: false, reason: weapons.reason };
  }

  const dualUse = matchRules(text, DUAL_USE_MILITARY);
  if (dualUse) {
    if (hasCivilianContext(text)) {
      return { allowedForRadar: true, reason: "Civilian technology (dual-use override)" };
    }
    return { allowedForRadar: false, reason: dualUse.reason };
  }

  return { allowedForRadar: true, reason: "Civilian technology" };
}

export function filterByContentPolicy(items: NewsItem[]): ContentPolicyFilterResult {
  const passed: NewsItem[] = [];
  const rejected: ContentPolicyFilterResult["rejected"] = [];

  for (const item of items) {
    const result = checkContentPolicy(item);
    if (result.allowedForRadar) {
      passed.push(item);
    } else {
      rejected.push({ item, result });
    }
  }

  return { passed, rejected };
}

export function isAllowedForRadar(item: NewsItem): boolean {
  return checkContentPolicy(item).allowedForRadar;
}
