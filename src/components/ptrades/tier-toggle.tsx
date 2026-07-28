import { cn } from "@/lib/utils";
import { TIERS, TIER_DESCRIPTION, TIER_LABEL, type Tier } from "@/lib/ptrades/tiers";

/**
 * Tier selector. Purely a presentation control over a stored preference — it
 * never changes how a signal is graded, only which tiers the user sees or is
 * sent.
 */
export function TierToggle({
  value,
  onChange,
  disabled,
  idPrefix,
  size = "default",
}: {
  value: Tier[];
  onChange: (next: Tier[]) => void;
  disabled?: boolean;
  idPrefix: string;
  size?: "default" | "sm";
}) {
  function toggle(tier: Tier) {
    onChange(value.includes(tier) ? value.filter((t) => t !== tier) : [...value, tier]);
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Alert tiers">
      {TIERS.map((tier) => {
        const active = value.includes(tier);
        return (
          <button
            key={tier}
            id={`${idPrefix}-${tier}`}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={TIER_DESCRIPTION[tier]}
            onClick={() => toggle(tier)}
            className={cn(
              "num rounded border font-semibold transition-colors disabled:opacity-50",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
              active
                ? "border-primary bg-primary/12 text-primary"
                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {TIER_LABEL[tier]}
          </button>
        );
      })}
    </div>
  );
}
