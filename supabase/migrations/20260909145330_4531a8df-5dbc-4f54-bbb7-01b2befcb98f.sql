-- 1. Units and context on the existing interventions table (no new intervention table).
ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS metric text NOT NULL DEFAULT 'SLA_ADHERENCE_PCT',
  ADD COLUMN IF NOT EXISTS improvement_abs numeric,
  ADD COLUMN IF NOT EXISTS shift text,
  ADD COLUMN IF NOT EXISTS hour smallint,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.interventions
  ADD CONSTRAINT interventions_metric_check
  CHECK (metric IN ('SLA_ADHERENCE_PCT', 'STAGE_MINUTES'));

-- Existing outcome values are normalised before the constraint is applied.
UPDATE public.interventions SET outcome = 'WORSENED' WHERE outcome = 'WORSE';

ALTER TABLE public.interventions
  ADD CONSTRAINT interventions_outcome_check
  CHECK (outcome IN ('PENDING', 'IMPROVED', 'NO_CHANGE', 'WORSENED', 'RESOLVED', 'NOT_APPLICABLE'));

ALTER TABLE public.interventions
  ADD CONSTRAINT interventions_hour_check CHECK (hour IS NULL OR (hour >= 0 AND hour <= 23));

ALTER TABLE public.interventions ALTER COLUMN action_at SET NOT NULL;
ALTER TABLE public.interventions ALTER COLUMN outcome SET NOT NULL;

-- 2. Audit trail: an edit never silently overwrites the previous measurement.
CREATE TABLE public.intervention_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NOT NULL REFERENCES public.interventions(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  previous jsonb NOT NULL
);

GRANT SELECT ON public.intervention_revisions TO authenticated;
GRANT ALL ON public.intervention_revisions TO service_role;

ALTER TABLE public.intervention_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intervention revisions readable by authenticated"
  ON public.intervention_revisions FOR SELECT TO authenticated USING (true);

CREATE INDEX intervention_revisions_intervention_idx
  ON public.intervention_revisions (intervention_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_intervention_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.intervention_revisions (intervention_id, changed_by, previous)
  VALUES (OLD.id, auth.uid(), to_jsonb(OLD));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_intervention_revision() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER log_intervention_revision
  BEFORE UPDATE ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.log_intervention_revision();