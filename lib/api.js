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
    const { data } = await res.json();
    return data;
  }

  // Metadata for one problem. Returns null if the slug doesn't exist (e.g. a
  // stale entry in a bundled list) — callers skip and move on.
  async function fetchQuestionMeta(slug) {
    try {
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
    } catch {
      return null;
    }
  }

  // Metadata for many slugs, fetched in parallel chunks. Preserves input
  // order; silently drops unknown and premium-only slugs. onProgress(done,
  // total) fires after each chunk so callers can show a counter.
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

  async function isSignedIn() {
    const data = await gql(`query { userStatus { isSignedIn } }`, {});
    return !!(data && data.userStatus && data.userStatus.isSignedIn);
  }

  // Every problem the signed-in user has solved, via the problemset query
  // with the AC status filter (the same query the problems page itself uses).
  async function fetchSolvedQuestions() {
    if (!(await isSignedIn())) throw new Error("not-signed-in");

    const QUERY = `query problemsetQuestionList(
      $categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput
    ) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters
      ) {
        total: totalNum
        questions: data {
          questionFrontendId title titleSlug difficulty topicTags { slug }
        }
      }
    }`;

    const out = [];
    const limit = 100;
    for (let skip = 0; skip < 3000; skip += limit) {
      const data = await gql(QUERY, {
        categorySlug: "",
        limit,
        skip,
        filters: { status: "AC" },
      });
      const block = data && data.problemsetQuestionList;
      if (!block || !block.questions || block.questions.length === 0) break;
      for (const q of block.questions) {
        out.push({
          slug: q.titleSlug,
          title: q.title,
          questionId: Number(q.questionFrontendId),
          difficulty: q.difficulty,
          tags: (q.topicTags || []).map((t) => t.slug),
        });
      }
      if (out.length >= block.total) break;
    }
    return out;
  }

  globalThis.LeetcodeAnki = globalThis.LeetcodeAnki || {};
  globalThis.LeetcodeAnki.api = {
    fetchQuestionMeta,
    fetchQuestionMetas,
    fetchSolvedQuestions,
    isSignedIn,
  };
})();
