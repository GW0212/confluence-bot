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

export function rankPages(question, pages) {
  const qLower = question.toLowerCase();
  const qCleaned = cleanQuestion(question).toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]"'?!]+/).filter(w => w.length >= 2);
  const qCleanedTokens = qCleaned.split(/\s+/).filter(w => w.length >= 1);

  const expandedKw = expandKeywords(qLower, [...qKeywords, ...qCleanedTokens]);

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
    const pn = getPatchNumber(p.title);
    if (pn > 0 && score > 0) score += pn * 0.05;
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  let relevant = scored.slice(0, 45);

  exactMatches.forEach(em => {
    relevant = relevant.filter(r => r.title !== em.title);
    relevant.unshift({ ...em, score: 9999 });
  });

  if (relevant.length < 5) {
    const fallback = pages.filter(p =>
      expandedKw.some(kw => kw && p.title.toLowerCase().includes(kw))
    ).slice(0, 25);
    fallback.forEach(f => {
      if (!relevant.find(r => r.title === f.title)) relevant.push(f);
    });
  }
  if (relevant.length === 0) relevant = pages.slice(0, 15);

  return { relevant: relevant.slice(0, 50), exactMatches, qCleaned };
}
