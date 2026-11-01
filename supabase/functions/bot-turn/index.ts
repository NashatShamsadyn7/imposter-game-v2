// ═══════════════════════════════════════════════════════════
//  Supabase Edge Function: bot-turn  (بۆتە زۆر زیرەکەکان — IQ بەرز)
//  وەسف (clue) دروستدەکات یان دەنگ دەدات بە بیرکردنەوەی قووڵ (reasoning).
//
//  API ـی هاوگونجاو لەگەڵ OpenAI بەکاردێنێت → دەتوانیت بیگۆڕیت تەنها بە
//  گۆڕینی BOT_API_URL / BOT_API_KEY / BOT_MODEL.
//
//  داواکاری (لە کلاینتەوە بە supabase.functions.invoke):
//   { action:'describe'|'vote', role, word, category, lang,
//     clues:[{name,text}], candidates:[{id,name}], impostorCount, botName,
//     round }
//  وەڵام:
//   describe → { text: "<یەک وشە>" }
//   vote     → { targetIds: ["<id>", ...] }
//
//  ناردن (Deploy):  supabase functions deploy bot-turn
//  Secrets (نموونەی Groq):
//    supabase secrets set BOT_API_KEY=gsk_... \
//      BOT_API_URL=https://api.groq.com/openai/v1/chat/completions \
//      BOT_MODEL=llama-3.3-70b-versatile
// ═══════════════════════════════════════════════════════════

const API_URL = Deno.env.get('BOT_API_URL') || 'https://api.groq.com/openai/v1/chat/completions'
const API_KEY = Deno.env.get('BOT_API_KEY') || ''
const MODEL = Deno.env.get('BOT_MODEL') || 'llama-3.3-70b-versatile'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// ئەگەر مۆدێلەکە لابرابوو (model_not_found)، لە /models مۆدێلێکی بەردەست هەڵدەبژێرین
let activeModel = MODEL

async function pickAvailableModel(): Promise<string | null> {
  const res = await fetch(API_URL.replace(/\/chat\/completions$/, '/models'), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  if (!res.ok) return null
  const ids: string[] = ((await res.json()).data || [])
    .filter((m: { active?: boolean }) => m.active !== false)
    .map((m: { id: string }) => m.id)
    .filter((id: string) => !/whisper|tts|guard|embed|vision|playai|orpheus/i.test(id))
  // مۆدێلی بێ «بیرکردنەوە» پێش دەخەین، چونکە ئاماژەکان تەنها ٣٢ تۆکنیان هەیە
  const prefs = [/llama.*70b/i, /llama-4/i, /llama/i, /gpt-oss-120b/i, /gpt-oss/i, /qwen/i]
  for (const re of prefs) {
    const hit = ids.find((id) => re.test(id))
    if (hit) return hit
  }
  return ids[0] || null
}

// بانگکردنی LLM. temperature نزم بۆ لۆژیک، بەرز بۆ سەرنجڕاکێشان.
async function chat(system: string, user: string, maxTokens = 400, temperature = 0.5): Promise<string> {
  // مۆدێلی reasoning پێش وەڵامدانەوە تۆکن دەخوات — بودجەی زیاتر و بیرکردنەوەی کەم
  const isReasoning = (model: string) => /gpt-oss|qwen3|deepseek-r1|qwq/i.test(model)
  const send = (model: string) => fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: isReasoning(model) ? Math.max(maxTokens, 1024) : maxTokens,
      ...(isReasoning(model) ? { reasoning_effort: 'low' } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  let res = await send(activeModel)
  if (res.status === 404 || res.status === 400) {
    const text = await res.text()
    if (!/model_not_found|decommissioned|does not exist/i.test(text)) throw new Error(`LLM error ${res.status}: ${text}`)
    const fallback = await pickAvailableModel()
    if (!fallback || fallback === activeModel) throw new Error(`LLM error ${res.status}: ${text}`)
    activeModel = fallback
    res = await send(activeModel)
  }
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return (data.choices?.[0]?.message?.content || '').trim()
}

const langName = (l: string) => (l === 'ar' ? 'Arabic' : 'Kurdish Sorani')

// دەرهێنانی دوایین JSON object/array لە دەقێکدا (بۆ reasoning + answer)
function lastJson(raw: string): unknown {
  // یەکەم: array
  const arr = raw.match(/\[[\s\S]*?\]/g)
  const obj = raw.match(/\{[\s\S]*?\}/g)
  const cand = [...(obj || []), ...(arr || [])]
  for (let i = cand.length - 1; i >= 0; i--) {
    try { return JSON.parse(cand[i]) } catch { /* بەردەوام */ }
  }
  return null
}

function cleanWord(s: string): string {
  return (s || '').split(/[\n،,]/)[0].replace(/["'`.!?:؛()]/g, '').trim().split(/\s+/).slice(0, 2).join(' ').slice(0, 40)
}

// هەڵبژاردنی باشترین وشە لە وەڵامی LLM بۆ ئاماژە:
// ١) ئەگەر JSON ـی {"clue":...} هەبوو  ٢) دوایین وشەی بە پیتی عەرەبی/کوردی
//  ٣) دوایین وشە. بەمە ڕێگری لە گەڕانەوەی دەقی بیرکردنەوەی ئینگلیزی دەکەین.
function extractClue(raw: string): string {
  const j = lastJson(raw) as { clue?: string } | null
  if (j?.clue) return cleanWord(j.clue)
  // وشەکانی بە نووسینی عەرەبی (کوردی سۆرانی + عەرەبی)
  const arabicTokens = raw.match(/[؀-ۿݐ-ݿ]+/g)
  if (arabicTokens && arabicTokens.length) return cleanWord(arabicTokens[arabicTokens.length - 1])
  const words = raw.replace(/[{}[\]"':,]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return cleanWord(words[words.length - 1] || raw)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!API_KEY) return json({ error: 'BOT_API_KEY not configured' }, 500)
    const body = await req.json()
    const {
      action, role, word, category, lang = 'ku',
      clues = [], candidates = [], impostorCount = 1, botName = 'Bot', round = 1,
      wordPool = [],
    } = body

    const lname = langName(lang)
    const clueText = clues.length
      ? clues.map((c: { name: string; text: string }) => `- ${c.name}: ${c.text}`).join('\n')
      : '(no clues given yet — you may be among the first to speak)'

    // ═════════════ وەسفکردن (clue) ═════════════
    if (action === 'describe') {
      const isImpostor = role === 'impostor'
      let system: string

      if (isImpostor) {
        // مخادع زۆر زیرەک: لیستی وشەکانی هاوپۆڵی پێدەدرێت → وشە نهێنییەکە
        // بە وردی لە ئاماژەکانەوە دەخوێنێتەوە، پاشان ئاماژەیەکی تەواو دەدات.
        const poolText = Array.isArray(wordPool) && wordPool.length
          ? `\nThe secret word is EXACTLY ONE of these ${wordPool.length} words from the category:\n${wordPool.join(' · ')}\n`
          : ''
        system =
`You are "${botName}", the IMPOSTOR in a Spyfall-style word game. Category: ${category || 'unknown'}. You do NOT know the secret word.
Other players' one-word clues (all describe the SAME hidden word):
${clueText}
${poolText}
Silently and rigorously deduce the SINGLE most likely secret word${poolText ? ' from that list' : ''} using the clues (match every clue, eliminate words that contradict any clue). Then give ONE clue a genuine insider for that exact word would naturally say:
- Specific and on-point for your deduced word so you sound like an expert.
- Safe: still believable if your deduction is off by a little.
- Must fit the category, must NOT duplicate any clue above, must NOT be generic filler.
Reply with ONLY that single clue word in ${lname}. No quotes, no English, no explanation.`
      } else {
        system =
`You are "${botName}", a CREW member in a Spyfall-style word game. The secret word is "${word}" (category: ${category || 'unknown'}). Round ${round}.
Clues already given:
${clueText}

Give ONE clever clue word that clearly relates to "${word}" so other crew know you're real, but:
- Never say the word, a part of it, its translation, or a dead-giveaway that hands it to the impostor.
- Do NOT repeat any clue above — pick a fresh angle (its use, where it's found, a part, a feeling, a close cousin).
- Round ${round}: ${round <= 1 ? 'be a little subtle' : 'be a bit more specific to help catch the impostor'}.
Reply with ONLY that single clue word in ${lname}. No quotes, no English, no explanation.`
      }

      const raw = await chat(system, 'Your one clue word:', 32, isImpostor ? 0.7 : 0.55)
      return json({ text: extractClue(raw) })
    }

    // ═════════════ دەنگدان (vote) ═════════════
    if (action === 'vote') {
      if (!candidates.length) return json({ targetIds: [] })
      const numbered = candidates
        .map((c: { id: string; name: string }, i: number) => `${i + 1}. ${c.name}`)
        .join('\n')
      const isImpostor = role === 'impostor'
      let system: string

      if (isImpostor) {
        // مخادع: مەبەست مانەوەیە — دەنگ بدە بە کەسێکی تر (نەک خۆت)، باشترە
        // ئەو کەسەی ئاماژەکەی لاوازترە یان گومانی لەسەرە، بۆ لادانی گومان.
        system =
`You are "${botName}", an IMPOSTOR voting in a Spyfall-style game. You do NOT know the secret word.
Clues:
${clueText}

Candidates:
${numbered}

Goal: SURVIVE and deflect suspicion. Vote for someone OTHER than yourself — prefer a crew member who looks suspicious or gave a weak/vague clue so the group follows you. Pick exactly ${impostorCount} candidate number(s).
Think in at most 2 short sentences, then output STRICT JSON on the last line: {"votes":[<numbers>]}`
      } else {
        // طاقم زیرەک: کلمەکە دەزانێت → ئاماژەی هەر کەسێک بەراورد دەکات لەگەڵ کلمەکە.
        system =
`You are "${botName}", a CREW member voting in a Spyfall-style game. The secret word is "${word || 'unknown'}" (category: ${category || 'unknown'}).
There are ${impostorCount} impostor(s) who do NOT know the word and gave clues that are vague, generic, off-category, or only loosely related.
Clues (name: clue):
${clueText}

Candidates:
${numbered}

Judge each candidate's clue against "${word}": an insider's clue is specific and clearly related; an impostor's clue is broad/safe, fits many words, or is slightly off. Ignore your own clue, then pick exactly the ${impostorCount} MOST suspicious candidate number(s).
Think in at most 2 short sentences, then output STRICT JSON on the last line: {"votes":[<numbers>]}`
      }

      let picks: number[] = []
      try {
        const raw = await chat(system, 'Reason briefly, then output the JSON.', 300, 0.2)
        const parsed = lastJson(raw)
        if (Array.isArray(parsed)) picks = parsed as number[]
        else if (parsed && Array.isArray((parsed as { votes?: number[] }).votes)) picks = (parsed as { votes: number[] }).votes
      } catch { /* fallback خوارەوە */ }

      let ids = picks
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length)
        .slice(0, impostorCount)
        .map((n) => candidates[n - 1].id)
      // ناهێڵین بۆتی مخادع دەنگ بداتە خۆی (ئەگەر بە هەڵە ڕوویدا)
      ids = [...new Set(ids)]
      if (!ids.length) {
        const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, impostorCount)
        ids = shuffled.map((c: { id: string }) => c.id)
      }
      return json({ targetIds: ids })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
