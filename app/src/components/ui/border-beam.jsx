import { cn } from "@/lib/utils"

// A beam of light running around the border of its (position: relative) parent.
// It is a conic gradient turned with a transform and seen through a mask that leaves only the border ring,
// so the animation runs on the compositor and costs the page nothing. The earlier version moved a block along
// an offset-path from JavaScript: the browser recomputed styles and repainted on every frame, for as long as
// the card was on screen, whether anything else was happening or not.
export const BorderBeam = ({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  style,
  reverse = false,
  borderWidth = 1
}) => {
  // Angle the beam covers, from its length in pixels on a card of ordinary size.
  const sweep = Math.max(15, Math.min(120, size / 2))
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ "--border-beam-width": `${borderWidth}px` }}
    >
      <div
        className={cn("absolute top-1/2 left-1/2 aspect-square w-[300%]", className)}
        style={{
          translate: "-50% -50%",
          background: `conic-gradient(from 0deg, transparent 0deg ${360 - sweep}deg, ${colorTo} ${360 - sweep}deg, ${colorFrom} 360deg)`,
          animation: `beam-spin ${duration}s linear ${-delay}s infinite ${reverse ? "reverse" : "normal"}`,
          willChange: "transform",
          ...style
        }}
      />
    </div>
  );
}
