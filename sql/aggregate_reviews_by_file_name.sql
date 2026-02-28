-- For each file_name, aggregate non-empty review texts into a single field,
-- each review separated by a newline character, ordered by most recent first.
SELECT
    file_name,
    STRING_AGG(reviews_translatedtext, E'\n' ORDER BY reviews_publishedatdate DESC) AS reviews_text
FROM public.rag_pos_plain_pos_reviews_reviews
WHERE reviews_translatedtext IS NOT NULL
  AND reviews_translatedtext <> ''
GROUP BY file_name
ORDER BY file_name;
