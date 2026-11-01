# دامەزراندنی Web Push (ئاگادارکردنەوە کاتێک ئەپ داخراوە)

هەموو کۆدەکە ئامادەیە. تەنها ئەم خشتانە جێبەجێ بکە بۆ چالاککردن.

---

## ١) دروستکردنی کلیلی VAPID

لە تێرمیناڵدا:

```bash
npx web-push generate-vapid-keys
```

دوو کلیل دەدات: **Public Key** و **Private Key**. هەڵیانبگرە.

---

## ٢) دانانی کلیلی گشتی لە Vercel (و .env ناوخۆیی)

لە Vercel > Project > Settings > Environment Variables زیاد بکە:

```
VITE_VAPID_PUBLIC_KEY = <Public Key>
```

(لە پەڕگەی `.env` ناوخۆییشدا هەمان شت زیاد بکە بۆ تاقیکردنەوەی local)

پاشان دووبارە deploy بکە (یان push بکە بۆ git).

---

## ٣) جێبەجێکردنی SQL

لە Supabase > SQL Editor، ناوەڕۆکی `supabase/migrations/20260530031842_push.sql` جێبەجێ بکە
(خشتەی `push_subscriptions` + RLS دروست دەکات).

---

## ٤) ناردنی Edge Function

پێویستت بە Supabase CLI هەیە:

```bash
# چوونەژوورەوە و بەستنەوە
supabase login
supabase link --project-ref lrqlrbnuukijigrkporv

# دانانی نهێنییەکان (secrets)
supabase secrets set \
  VAPID_PUBLIC_KEY=<Public Key> \
  VAPID_PRIVATE_KEY=<Private Key> \
  VAPID_SUBJECT=mailto:nashatgameryt7@gmail.com

# ناردنی فەنکشن
supabase functions deploy send-push --no-verify-jwt
```

> `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` بە شێوەی ئۆتۆماتیک بەردەستن لەناو فەنکشنەکەدا.

---

## ٥) بەستنەوەی Trigger / Webhook

**ڕێگەی A — Database Webhooks (ئاسانتر):**
Supabase > Database > Webhooks > Create:
- Table: `direct_messages` ، Event: `INSERT`
- Type: Supabase Edge Function → `send-push`
- هەمان شت بۆ `friendships` (INSERT)

**ڕێگەی B — SQL Trigger:**
لە Dashboard > Database > Extensions ئەکستێنشنی `pg_net` چالاک بکە،
پاشان لە `supabase/migrations/20260530031842_push.sql` ئەو بەشەی کۆمێنتکراوە (`notify_push`) لێبکەرەوە و
`<PROJECT_REF>` و `<SERVICE_ROLE_KEY>` بگۆڕە، ئینجا جێبەجێی بکە.

---

## ٦) تاقیکردنەوە

1. ئەپ بکەرەوە، بڕۆ بۆ **ڕێکخستنەکان** و **ئاگادارکردنەوەی Push** چالاک بکە.
2. ئەپ بەتەواوی دابخە.
3. لە ئامێرێکی تر / هەژمارێکی تر نامەیەک بنێرە یان داواکاری هاوڕێیەتی بکە.
4. دەبێت ئاگادارکردنەوەی سیستەم بێت، تەنانەت ئەگەر ئەپ داخرابێت.

> تێبینی iOS: دەبێت ئەپەکە وەک PWA لەسەر ڕووی ماڵەوە دامەزرابێت (Add to Home Screen)
> و iOS 16.4+ بێت بۆ ئەوەی Web Push کاربکات.
