// ── 한국어 기획서 검색/랭킹 전용 모듈 ──
// 목적: 질문과 가장 관련성 높은 기획서 페이지를 정밀하게 찾아내는 것

const STOPWORDS = [
  '시스템', '기획', '내용', '설명해', '설명', '알려줘', '알려', '줘', '뭐야', '뭔가요',
  '란', '이란', '에 대해', '에대해', '관련', '해줘', '인가요', '인지', '하는', '되는',
  '있나요', '있는지', '무엇', '어떻게', '어떤', '대해서', '대해', '좀'
];
const PARTICLES = ['이', '가', '은', '는', '을', '를', '에', '에서', '으로', '로', '와', '과', '의', '도', '만', '까지', '부터'];

export function cleanQuestion(q) {
  let s = q;
  STOPWORDS.forEach(w => { s = s.split(w).join(' '); });
  s = s.replace(/[?!？！.,]/g, ' ');
  s = s.split(/\s+/).map(token => {
    if (token.length <= 2) return token;
    for (const p of PARTICLES) {
      if (token.endsWith(p) && token.length - p.length >= 2) {
        return token.slice(0, -p.length);
      }
    }
    return token;
  }).join(' ');
  return s.replace(/\s+/g, ' ').trim();
}

export const SYNONYMS = {
  '전투': ['전투', '스킬', '경직', '공격', '방어', '밸런스', '대미지', '데미지'],
  '캐릭터': ['캐릭터', '직업', '속도', '능력치', '스탯'],
  '콘텐츠': ['콘텐츠', '던전', '필드', '레이드', '보스', '사냥터'],
  '아이템': ['아이템', '장비', '소환', '소환사', '컬렉션'],
  '패치': ['패치', '업데이트', '버전', '노트'],
  '시스템': ['시스템', '기능', '구조'],
  'pk': ['pk', '불명예', '결투', '척살'],
  '경직': ['경직', '스턴', '블렌딩', '피격'],
  '운명': ['운명', '카드', '능력치'],
};

export function expandKeywords(qLower, baseKeywords) {
  let expanded = [...baseKeywords];
  Object.keys(SYNONYMS).forEach(key => {
    if (qLower.includes(key)) expanded = expanded.concat(SYNONYMS[key]);
  });
  return [...new Set(expanded)];
}

export function getPatchNumber(title) {
  const m = title.match(/[Mm](\d+)/);
  return m ? parseInt(m[1]) : 0;
}

/**
 * "M57.0", "m57", "M57.2" 등에서 메이저 버전 번호만 추출 ("57")
 * 패치/버전 표기는 마이너 버전(.0, .2 등)이 달라도 같은 메이저 패치로 취급해야
 * "M57.0 알려줘" 질문이 "M57" 페이지를 찾을 수 있다.
 */
function extractVersionTokens(text) {
  const tokens = [];
  // M57, M57.0, M57.2 같은 패턴을 모두 찾아서 메이저 번호만 추출
  const matches = text.matchAll(/[Mm](\d+)(?:\.\d+)?/g);
  for (const m of matches) tokens.push('m' + m[1]);
  return [...new Set(tokens)];
}

/**
 * 일반화된 "느슨한 토큰 매칭": 숫자+마이너버전 표기 차이를 무시하고
 * 같은 핵심 식별자(영문+숫자 조합)를 가지면 매칭되도록 처리.
 * 예) "M57.0" ~ "M57", "Q7" ~ "Q7.1", "1.5.0" ~ "1.5" 등에도 일반적으로 동작.
 */
function normalizeIdentifier(token) {
  // 끝에 붙은 .숫자(마이너/패치 버전)를 제거하고 핵심 식별자만 남김
  return token.replace(/(\.\d+)+$/g, '');
}

function tokenizeIdentifiers(text) {
  // 영문+숫자+점으로 이루어진 식별자 패턴 전체 추출 (M57.0, Q7, v1.2.3 등)
  const matches = text.match(/[A-Za-z]+\d+(?:\.\d+)*/g) || [];
  return matches.map(t => t.toLowerCase());
}

export function rankPages(question, pages) {
  const qLower = question.toLowerCase();
  const qCleaned = cleanQuestion(question).toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]"'?!]+/).filter(w => w.length >= 2);
  const qCleanedTokens = qCleaned.split(/\s+/).filter(w => w.length >= 1);

  const expandedKw = expandKeywords(qLower, [...qKeywords, ...qCleanedTokens]);

  // 버전/식별자 토큰 정규화 (M57.0 → m57)
  const qVersionTokens = extractVersionTokens(question);
  const qIdentifiers = tokenizeIdentifiers(question).map(normalizeIdentifier);

  // 버전 토큰이 하나라도 일치하면 무조건 exactMatches에 포함 (같은 패치 관련 페이지 누락 방지)
  // 예: "M58 계획 있어?" → 제목에 M58/m58/M58.0 등이 들어간 모든 페이지를 강제 포함
  const exactMatches = pages.filter(p => {
    const tl = p.title.toLowerCase().trim();
    if (!tl) return false;
    if (tl === qCleaned) return true;
    if (qCleaned.includes(tl) && tl.length >= 2) return true;
    if (qCleanedTokens.some(kw => tl === kw && kw.length >= 2)) return true;
    if (tl.length >= 2 && tl.length <= 8) {
      const titleNoSpace = tl.replace(/\s+/g, '');
      const qNoSpace = qLower.replace(/\s+/g, '');
      if (qNoSpace.includes(titleNoSpace)) return true;
    }
    // 버전 토큰 매칭: 질문의 "m58" 토큰이 제목에 등장하면 그 페이지는 같은 패치 관련 자료이므로 무조건 포함
    if (qVersionTokens.length > 0) {
      const titleVersionTokens = extractVersionTokens(p.title);
      if (titleVersionTokens.some(t => qVersionTokens.includes(t))) return true;
    }
    // 일반 식별자 매칭: M57.0 ~ M57, Q7 ~ Q7.1 같은 패턴을 범용으로 처리
    if (qIdentifiers.length > 0) {
      const titleIdentifiers = tokenizeIdentifiers(p.title).map(normalizeIdentifier);
      if (titleIdentifiers.some(t => qIdentifiers.includes(t))) return true;
    }
    return false;
  });

  const scored = pages.map(p => {
    const tl = p.title.toLowerCase();
    const cl = p.content.toLowerCase();
    let score = 0;
    expandedKw.forEach(kw => {
      if (!kw) return;
      if (tl === kw) score += 60;
      else if (tl.includes(kw)) score += 12;
      const occurrences = cl.split(kw).length - 1;
      if (occurrences > 0) score += Math.min(occurrences, 8) * 1.2;
    });
    // 버전/식별자 토큰 가중치 부여 (정규화된 매칭 시 강한 가중치)
    if (qVersionTokens.length > 0) {
      const titleVersionTokens = extractVersionTokens(p.title);
      if (titleVersionTokens.some(t => qVersionTokens.includes(t))) score += 80;
    }
    if (qIdentifiers.length > 0) {
      const titleIdentifiers = tokenizeIdentifiers(p.title).map(normalizeIdentifier);
      if (titleIdentifiers.some(t => qIdentifiers.includes(t))) score += 40;
    }
    const pn = getPatchNumber(p.title);
    if (pn > 0 && score > 0) score += pn * 0.05;
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  // exactMatches(버전/제목 일치)는 절대 잘리지 않도록 먼저 전부 확보하고,
  // 남는 공간만큼만 점수 기반 일반 페이지를 추가한다.
  const exactTitles = new Set(exactMatches.map(em => em.title));
  const generalScored = scored.filter(p => !exactTitles.has(p.title));

  const MAX_TOTAL = 60; // exactMatches가 많아도 전체 한도를 약간 넉넉하게
  const remainSlots = Math.max(0, MAX_TOTAL - exactMatches.length);
  let relevant = generalScored.slice(0, remainSlots);

  // exactMatches를 맨 앞에 배치 (최고 우선순위, 절대 누락 없음)
  relevant = [...exactMatches.map(em => ({ ...em, score: 9999 })), ...relevant];

  if (relevant.length < 5) {
    const fallback = pages.filter(p =>
      expandedKw.some(kw => kw && p.title.toLowerCase().includes(kw))
    ).slice(0, 25);
    fallback.forEach(f => {
      if (!relevant.find(r => r.title === f.title)) relevant.push(f);
    });
  }
  if (relevant.length === 0) relevant = pages.slice(0, 15);

  return { relevant, exactMatches, qCleaned };
}
