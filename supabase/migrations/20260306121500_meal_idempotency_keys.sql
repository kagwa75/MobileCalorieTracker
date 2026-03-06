ALTER TABLE public.meals
ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE public.meals
DROP CONSTRAINT IF EXISTS meals_client_request_id_length_check;

ALTER TABLE public.meals
ADD CONSTRAINT meals_client_request_id_length_check
CHECK (client_request_id IS NULL OR char_length(client_request_id) BETWEEN 8 AND 120);

DROP INDEX IF EXISTS idx_meals_user_client_request_id;
CREATE UNIQUE INDEX idx_meals_user_client_request_id ON public.meals (user_id, client_request_id);

ALTER TABLE public.meal_items
ADD COLUMN IF NOT EXISTS client_item_index INT;

DROP INDEX IF EXISTS idx_meal_items_unique_client_index;

CREATE UNIQUE INDEX idx_meal_items_unique_client_index
ON public.meal_items (meal_id, client_item_index);
