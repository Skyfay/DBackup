import { cn } from "@/lib/utils";

interface SparklineProps {
    /** One value per point, null for gaps. */
    values: (number | null)[];
    /** Sets the color: the line and the area underneath use currentColor. */
    className?: string;
    /** Scales from zero instead of from the lowest value, so a flat count does not look volatile. */
    fromZero?: boolean;
}

const WIDTH = 100;
const HEIGHT = 32;
const PADDING = 2;

/** A small trend line with a faint area, stretched to the width of its container. */
export function Sparkline({ values, className, fromZero = false }: SparklineProps) {
    const points = values.flatMap((value, index) => (value === null ? [] : [{ value, index }]));

    if (points.length < 2) {
        return <div className={cn("h-10", className)} aria-hidden="true" />;
    }

    const numbers = points.map((point) => point.value);
    const min = fromZero ? Math.min(0, ...numbers) : Math.min(...numbers);
    const max = Math.max(...numbers);
    const x = (index: number) => (index / (values.length - 1)) * WIDTH;
    // A flat series sits in the middle, except a flat zero on a zero-based scale, which belongs at the bottom.
    const flatY = fromZero && max === 0 ? HEIGHT - PADDING : HEIGHT / 2;
    const y = (value: number) =>
        max === min ? flatY : HEIGHT - PADDING - ((value - min) / (max - min)) * (HEIGHT - PADDING * 2);

    const line = points
        .map((point, i) => `${i === 0 ? "M" : "L"}${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`)
        .join(" ");
    const first = points[0];
    const last = points[points.length - 1];
    const area = `${line} L${x(last.index).toFixed(2)},${HEIGHT} L${x(first.index).toFixed(2)},${HEIGHT} Z`;

    return (
        <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className={cn("h-10 w-full overflow-visible", className)}
            aria-hidden="true"
        >
            <path d={area} fill="currentColor" fillOpacity={0.12} />
            <path
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}
