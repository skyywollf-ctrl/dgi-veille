// Sociétés asiatiques préremplies pour l'onglet Découverte
// Suffixes Yahoo Finance : .HK (Hong Kong), .T (Tokyo), .KS (Korea)
// BABA = ADR US (pas .HK)

export const ASIA_COMPANIES = [
  // ============ CHINE / HONG KONG ============
  {
    ticker: "0700.HK",
    name: "Tencent",
    country: "🇨🇳 Chine / HK",
    sector: "Tech / Gaming",
    description: "Géant chinois de la tech : WeChat (l'app omniprésente en Chine), gaming (premier éditeur mondial via Riot, Supercell, Epic Games), cloud, fintech via WeChat Pay. Capitalisation parmi les plus grosses d'Asie. Très exposé aux décisions réglementaires de Pékin sur la tech et le gaming."
  },
  {
    ticker: "BABA",
    name: "Alibaba",
    country: "🇨🇳 Chine (ADR US)",
    sector: "E-commerce / Cloud",
    description: "Amazon chinois (Taobao, Tmall) + numéro 1 chinois du cloud. Coté à NY (BABA) et HK (9988.HK) — c'est un ADR via une structure VIE (Variable Interest Entity), tu ne détiens pas directement les actions chinoises. Risque réglementaire élevé depuis le clash avec Pékin en 2020."
  },
  {
    ticker: "1211.HK",
    name: "BYD",
    country: "🇨🇳 Chine / HK",
    sector: "Auto électrique / Batteries",
    description: "Premier constructeur mondial de véhicules électriques (devant Tesla en volume). Intégration verticale rare : fabrique ses propres batteries, semi-conducteurs, moteurs. Warren Buffett actionnaire historique via Berkshire Hathaway. Expansion agressive en Europe et Asie du Sud-Est."
  },
  {
    ticker: "0883.HK",
    name: "CNOOC",
    country: "🇨🇳 Chine / HK",
    sector: "Pétrole offshore",
    description: "Major pétrolière chinoise, spécialisée offshore. Dividende élevé (souvent >7%), valorisation faible. Sanctions US qui l'excluent de la cote américaine depuis 2021 — accessible uniquement via HK. Sensible au prix du pétrole et aux relations Pékin-Washington."
  },
  {
    ticker: "1398.HK",
    name: "ICBC",
    country: "🇨🇳 Chine / HK",
    sector: "Banque",
    description: "Plus grande banque du monde par actifs. Yield très élevé (~7-8%) qui attire mais reflète un risque réel : exposition à l'immobilier chinois en crise, marges sous pression, contrôle d'État. À manier avec prudence si tu y vas, position modeste max."
  },

  // ============ JAPON ============
  {
    ticker: "7203.T",
    name: "Toyota",
    country: "🇯🇵 Japon",
    sector: "Automobile",
    description: "Premier constructeur auto mondial en volume. Valeur sûre japonaise, dividende régulier, bilan en béton. Stratégie hybride privilégiée à l'électrique pur — pari à long terme controversé. Bénéficie d'un yen faible pour ses exports."
  },
  {
    ticker: "6758.T",
    name: "Sony",
    country: "🇯🇵 Japon",
    sector: "Tech / Divertissement",
    description: "Conglomérat tech : PlayStation (gaming), capteurs photo CMOS (équipe la plupart des smartphones), musique (Sony Music), films, semi-conducteurs. Très diversifié, exposition mondiale, marque iconique."
  },
  {
    ticker: "8306.T",
    name: "Mitsubishi UFJ Financial",
    country: "🇯🇵 Japon",
    sector: "Banque",
    description: "Plus grande banque japonaise. Grande bénéficiaire de la fin des taux négatifs au Japon (BoJ qui sort enfin de sa politique ultra-accommodante). Actionnaire de Morgan Stanley (~24%). Yield correct, valorisation historiquement basse."
  },
  {
    ticker: "7974.T",
    name: "Nintendo",
    country: "🇯🇵 Japon",
    sector: "Gaming",
    description: "Switch + IP iconiques (Mario, Zelda, Pokémon). Cash flow massif et trésorerie net cash colossale. Cycle produit lié aux sorties de console — cours volatil entre les générations. Politique de dividende variable indexée sur le résultat."
  },
  {
    ticker: "6861.T",
    name: "Keyence",
    country: "🇯🇵 Japon",
    sector: "Automation industrielle",
    description: "Capteurs, vision industrielle, automation pour usines. Marges opérationnelles parmi les plus hautes au monde (>50%). Modèle commercial direct sans distributeurs. Yield faible (<1%) mais qualité de business exceptionnelle, c'est un compounder plus qu'un titre à dividende."
  },

  // ============ CORÉE DU SUD ============
  {
    ticker: "005930.KS",
    name: "Samsung Electronics",
    country: "🇰🇷 Corée",
    sector: "Semi-conducteurs / Électronique",
    description: "Numéro 1 mondial de la mémoire (DRAM, NAND) et des smartphones Android. Cyclique sur les semi (cycles up/down marqués). Forte exposition à l'IA via la mémoire HBM. La structure capitalistique avec actions préférentielles (005935.KS) avec yield plus élevé est à connaître."
  },
  {
    ticker: "000660.KS",
    name: "SK Hynix",
    country: "🇰🇷 Corée",
    sector: "Mémoire / IA",
    description: "Numéro 2 mondial de la mémoire derrière Samsung. Leader sur la mémoire HBM utilisée par Nvidia pour ses GPU IA — gros bénéficiaire du boom IA. Très cyclique, attention aux points d'entrée."
  },
  {
    ticker: "005380.KS",
    name: "Hyundai Motor",
    country: "🇰🇷 Corée",
    sector: "Automobile",
    description: "Hyundai + Kia = troisième groupe auto mondial. Bon positionnement EV (Ioniq), valorisation modeste comparée aux constructeurs occidentaux. Yield correct. Exposition aux droits de douane US sur l'auto étrangère."
  }
];

// ============================================
// NOTES PIÉGEUSES SPÉCIFIQUES ASIE (affichées dans chaque fiche découverte)
// ============================================
export const ASIA_WARNINGS = [
  {
    title: "Tickers ADR vs locaux",
    text: "BABA (NYSE) ≠ 9988.HK (même boîte, instruments différents). Idem JD, BIDU, NIO. Les ADR exposent au risque de délisting US. Préférer les cotes locales (HK) si tu peux y accéder via ton broker."
  },
  {
    title: "Fiscalité dividendes",
    text: "Hong Kong : 0% retenue à la source. Japon : 15% via convention fiscale franco-japonaise (10% remboursables sur demande). Corée du Sud : 22% retenue (~15.4% selon convention)."
  },
  {
    title: "Risque réglementaire chinois & VIE",
    text: "Les actions tech chinoises (BABA, JD, BIDU, PDD) sont souvent des VIE — structures juridiques offshore où tu ne détiens pas l'actif chinois directement. Risque de requalification par Pékin et risque de délisting US. Tencent est coté à HK directement, c'est plus propre."
  },
  {
    title: "Heures de cotation décalées",
    text: "HK : 03h30–10h00 heure de Paris. Tokyo : 01h00–07h00. Séoul : 01h00–07h30. Tu ne peux pas trader pendant ta journée de travail — passe des ordres limites."
  }
];
