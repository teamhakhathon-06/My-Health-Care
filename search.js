/* =========================================================
   MedVault — High-Performance Search Engine (search.js)
   Accurate, Tokenized, Weighted Search & Data Optimizer
   ========================================================= */

(function (global) {
  "use strict";

  const STOP_WORDS = new Set([
    "a", "about", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "have", "how", "i", "in", "is", "it", "of", "on", "or", "that",
    "the", "this", "to", "was", "what", "when", "where", "who", "will", "with"
  ]);

  let searchIndex = [];
  let isIndexed = false;

  /**
   * Helper function for simple stemming / normalization (removing trailing 's')
   */
  function normalizeWord(word) {
    if (!word) return "";
    let w = word.toLowerCase();
    if (w.length > 3 && w.endsWith("s")) {
      w = w.slice(0, -1);
    }
    return w;
  }

  /**
   * Tokenizes and normalizes input text.
   */
  function tokenize(text) {
    if (!text) return [];
    return String(text)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(token => token.length > 1 && !STOP_WORDS.has(token));
  }

  /**
   * Cleans and normalizes standard knowledge items.
   */
  function normalizeItem(raw, idx) {
    const keywords = Array.isArray(raw.keywords)
      ? raw.keywords.map(String)
      : typeof raw.keywords === "string"
      ? raw.keywords.split(",").map(k => k.trim())
      : [];

    const content = typeof raw.content === "string" 
      ? raw.content 
      : Array.isArray(raw.content) 
      ? raw.content.join(" ") 
      : "";

    const source = typeof raw.source === "string" 
      ? raw.source 
      : typeof raw.content === "string" 
      ? raw.source || "MedVault local knowledge"
      : "MedVault local knowledge";

    return {
      id: String(raw.id || `knowledge-${idx}`),
      title: String(raw.title || raw.name || `Topic ${idx}`),
      section: String(raw.section || raw.category || "General"),
      keywords: keywords,
      content: content.trim(),
      source: String(source)
    };
  }

  /**
   * Indexes knowledge items for fast retrieval.
   */
  function indexKnowledgeBase(items) {
    if (!Array.isArray(items)) return [];
    
    searchIndex = items.map((rawItem, idx) => {
      const item = normalizeItem(rawItem, idx);
      const titleToks = tokenize(item.title);
      const kwToks = tokenize(item.keywords.join(" "));
      const secToks = tokenize(item.section);
      const cntToks = tokenize(item.content);

      return {
        item,
        titleTokens: titleToks,
        keywordsTokens: kwToks,
        sectionTokens: secToks,
        contentTokens: cntToks,
        stemmedTitleTokens: titleToks.map(normalizeWord),
        stemmedKwTokens: kwToks.map(normalizeWord),
        stemmedCntTokens: cntToks.map(normalizeWord),
        rawTitleLower: item.title.toLowerCase(),
        rawContentLower: item.content.toLowerCase()
      };
    }).filter(indexed => indexed.item.content.length > 0);

    isIndexed = true;
    return searchIndex.map(si => si.item);
  }

  /**
   * High-accuracy search algorithm.
   */
  function executeSearch(query, maxResults = 8) {
    const cleanQuery = String(query || "").trim().toLowerCase();
    if (!cleanQuery) return [];

    const queryTokens = tokenize(cleanQuery);
    if (!queryTokens.length && cleanQuery.length > 0) {
      queryTokens.push(cleanQuery);
    }
    const stemmedQueryTokens = queryTokens.map(normalizeWord);

    const results = [];

    for (let i = 0; i < searchIndex.length; i++) {
      const record = searchIndex[i];
      let score = 0;

      // 1. Exact Full Query Matches
      if (record.rawTitleLower === cleanQuery) score += 100;
      else if (record.rawTitleLower.includes(cleanQuery)) score += 40;
      
      if (record.rawContentLower.includes(cleanQuery)) score += 20;

      // 2. Token Weighting
      queryTokens.forEach((qToken, qIdx) => {
        const stemmedQToken = stemmedQueryTokens[qIdx];

        // Title Token Matches
        record.titleTokens.forEach((tToken, tIdx) => {
          const stemmedTToken = record.stemmedTitleTokens[tIdx];
          if (tToken === qToken || stemmedTToken === stemmedQToken) score += 25;
          else if (tToken.includes(qToken) || qToken.includes(tToken) || stemmedTToken.includes(stemmedQToken) || stemmedQToken.includes(stemmedTToken)) score += 10;
        });

        // Keywords Token Matches
        record.keywordsTokens.forEach((kToken, kIdx) => {
          const stemmedKToken = record.stemmedKwTokens[kIdx];
          if (kToken === qToken || stemmedKToken === stemmedQToken) score += 18;
          else if (kToken.includes(qToken) || stemmedKToken.includes(stemmedQToken)) score += 8;
        });

        // Section Token Matches
        record.sectionTokens.forEach(sToken => {
          if (sToken === qToken || normalizeWord(sToken) === stemmedQToken) score += 12;
        });

        // Content Token Matches
        record.contentTokens.forEach((cToken, cIdx) => {
          const stemmedCToken = record.stemmedCntTokens[cIdx];
          if (cToken === qToken || stemmedCToken === stemmedQToken) score += 3;
          else if (cToken.includes(qToken) || stemmedCToken.includes(stemmedQToken)) score += 1;
        });
      });

      if (score > 0) {
        results.push({ item: record.item, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  // Export engine methods globally
  global.MedVaultSearchEngine = {
    index: indexKnowledgeBase,
    search: executeSearch,
    isReady: () => isIndexed
  };

})(typeof window !== "undefined" ? window : globalThis);
