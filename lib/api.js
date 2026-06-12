// LeetCode GraphQL access. Same-origin from content scripts, so requests
// ride the user's existing session cookie — no auth flow. Browser-only.
(function () {
  async function gql(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`graphql ${res.status}`);
    const json = await res.json();
    // GraphQL failures (rate limits included) arrive as 200s with an errors
    // array. An unknown slug is NOT one of these — LeetCode answers that
    // with { data: { question: null } } and no errors — so throwing here
    // never masks a stale list entry, only real failures.
    if (json.errors && json.errors.length > 0) {
      throw new Error(`graphql: ${json.errors[0].message || "unknown error"}`);
    }
    return json.data;
  }

  // Metadata for one problem. Returns null if the slug doesn't exist (e.g. a
  // stale entry in a bundled list) — callers skip and move on. Request
  // failures throw, so a rate-limited bulk seed aborts loudly instead of
  // silently dropping problems; single-card callers catch and fall back to
  // DOM-scraped metadata.
  async function fetchQuestionMeta(slug) {
    const data = await gql(
      `query q($slug: String!) {
        question(titleSlug: $slug) {
          questionFrontendId title difficulty isPaidOnly topicTags { slug }
        }
      }`,
      { slug }
    );
    const q = data && data.question;
    if (!q) return null;
    return {
      title: q.title,
      questionId: Number(q.questionFrontendId),
      difficulty: q.difficulty,
      tags: (q.topicTags || []).map((t) => t.slug),
      paidOnly: !!q.isPaidOnly,
    };
  }

  // Metadata for many slugs, fetched in parallel chunks. Preserves input
  // order; silently drops unknown and premium-only slugs, but throws on any
  // request failure so a bulk seed never quietly completes with holes.
  // onProgress(done, total) fires after each chunk so callers can show a
  // counter.
  async function fetchQuestionMetas(slugs, { concurrency = 8, onProgress } = {}) {
    const out = [];
    let done = 0;
    for (let i = 0; i < slugs.length; i += concurrency) {
      const chunk = slugs.slice(i, i + concurrency);
      const metas = await Promise.all(chunk.map(fetchQuestionMeta));
      chunk.forEach((slug, j) => {
        done++;
        const meta = metas[j];
        if (meta && !meta.paidOnly) {
          const { paidOnly, ...rest } = meta;
          out.push({ slug, ...rest });
        }
      });
      if (onProgress) onProgress(done, slugs.length);
    }
    return out;
  }

  globalThis.LeetcodeAnki = globalThis.LeetcodeAnki || {};
  globalThis.LeetcodeAnki.api = {
    fetchQuestionMeta,
    fetchQuestionMetas,
  };
})();
