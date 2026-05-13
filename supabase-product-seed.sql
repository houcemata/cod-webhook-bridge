-- ARCO product seed draft.
-- Run this in Supabase SQL editor after replacing image URLs with final assets.
-- Products are inactive by default so they can be reviewed in Admin before publishing.

insert into products
  (name, slug, description_ar, description_fr, price, original_price, shipping_cost, images, variants, active)
values
  (
    'Liquid Football',
    'liquid-football',
    'بوسترات فنية فاخرة بطابع الأندية، اختر الفريق والمقاس والولاية والدفع عند الاستلام.',
    'Affiches football premium avec sélection du club, taille, livraison et paiement à la livraison.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    true
  ),
  (
    'Real Madrid Liquid Art',
    'real-madrid-liquid-art',
    'بوستر فني فاخر بطابع ريال مدريد، مطبوع بجودة عالية ومتوفر بالدفع عند الاستلام.',
    'Affiche premium inspiration Real Madrid, finition forte et paiement à la livraison.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1552066379-e7bfd22155c8?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'Barcelona Liquid Art',
    'barcelona-liquid-art',
    'بوستر فني فاخر بطابع برشلونة، مناسب للغرف والمكاتب ومحبي الكرة.',
    'Affiche premium inspiration Barcelona, idéale pour chambre, bureau et fans de football.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'Manchester City Liquid Art',
    'manchester-city-liquid-art',
    'تصميم فني بطابع مانشستر سيتي، ألوان قوية وطباعة واضحة.',
    'Design premium inspiration Manchester City, couleurs fortes et impression nette.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'Manchester United Liquid Art',
    'manchester-united-liquid-art',
    'بوستر بطابع مانشستر يونايتد لعشاق التصاميم الكروية الجريئة.',
    'Affiche inspiration Manchester United pour les fans de posters football premium.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1518091043644-c1d4457512c6?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'Liverpool Liquid Art',
    'liverpool-liquid-art',
    'بوستر فني بطابع ليفربول، لمسة قوية لديكور الغرفة.',
    'Affiche inspiration Liverpool avec rendu fort pour décoration murale.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1553778263-73a83bab9b0c?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'PSG Liquid Art',
    'psg-liquid-art',
    'بوستر بطابع باريس سان جيرمان، تصميم عصري وطباعة فاخرة.',
    'Affiche inspiration PSG, design moderne et impression premium.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'AC Milan Liquid Art',
    'ac-milan-liquid-art',
    'بوستر فني بطابع ميلان، ألوان كلاسيكية ولمسة فاخرة.',
    'Affiche inspiration AC Milan, couleurs classiques et finition premium.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'Juventus Liquid Art',
    'juventus-liquid-art',
    'بوستر فني بطابع يوفنتوس، ستايل نظيف وفاخر.',
    'Affiche inspiration Juventus avec style sobre et premium.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  ),
  (
    'Bayern Munich Liquid Art',
    'bayern-munich-liquid-art',
    'بوستر فني بطابع بايرن ميونخ، طباعة قوية ومظهر مميز.',
    'Affiche inspiration Bayern Munich, impression forte et rendu distinctif.',
    2900,
    3900,
    0,
    array['https://images.unsplash.com/photo-1526232761682-d26e03ac148e?auto=format&fit=crop&w=1200&q=80'],
    '[{"label":"30x40 cm","price":2900},{"label":"40x60 cm","price":3900}]'::jsonb,
    false
  )
on conflict (slug) do update set
  name = excluded.name,
  description_ar = excluded.description_ar,
  description_fr = excluded.description_fr,
  price = excluded.price,
  original_price = excluded.original_price,
  shipping_cost = excluded.shipping_cost,
  images = excluded.images,
  variants = excluded.variants,
  active = products.active;
