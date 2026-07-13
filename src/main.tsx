import { createContext, StrictMode, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, ArrowRight, Clock3, Flame, Gauge, Radio, Sparkles, TrendingUp, Users, Zap } from "lucide-react";
import "./styles.css";

type PulseState = "Prime" | "Good" | "Busy" | "Oversaturated";
type Tone = "positive" | "negative" | "neutral" | "info" | "warning";

type Signal = {
  label: string;
  value: string;
  tone: Tone;
  detail: string;
};

type Metric = {
  label: string;
  value: string;
  delta?: string;
  tone?: Tone;
  deltaTone?: Tone;
};

type Category = {
  name: string;
  momentum: number;
  viewers: string;
  creators: number;
  trend: "up" | "down" | "flat";
};

type TimelinePoint = {
  hour: string;
  score: number;
};

type PulseData = {
  status?: "loading" | "ready" | "stale" | "error";
  state: PulseState;
  score: number;
  recommendation: string;
  recommendationDetail: string;
  lastUpdated: string;
  pressure: {
    label: string;
    index: number;
    creatorVelocity: string;
    openWindow: string;
  };
  metrics: Metric[];
  signals: Signal[];
  categories: Category[];
  timeline: TimelinePoint[];
  error?: string;
};

const emptyTimeline: TimelinePoint[] = [
  "00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22",
].map((hour) => ({ hour, score: 0 }));

const loadingPulse: PulseData = {
  status: "loading",
  state: "Busy",
  score: 0,
  recommendation: "Checking Blaze",
  recommendationDetail: "Connecting to the live Blaze ecosystem feed.",
  lastUpdated: "Connecting",
  pressure: {
    label: "Pending",
    index: 0,
    creatorVelocity: "0%",
    openWindow: "0m",
  },
  metrics: [
    { label: "Live viewers", value: "--", tone: "neutral" },
    { label: "Live creators", value: "--", tone: "neutral" },
    { label: "Average viewers", value: "--", tone: "neutral" },
    { label: "New streams / 15m", value: "--", tone: "neutral" },
  ] satisfies Metric[],
  signals: [
    { label: "Blaze API", value: "Connecting", tone: "neutral", detail: "Waiting for the first live ecosystem snapshot." },
  ] satisfies Signal[],
  categories: [],
  timeline: emptyTimeline,
};

const PulseContext = createContext<PulseData>(loadingPulse);

const stateCopy: Record<PulseState, string> = {
  Prime: "The window is open",
  Good: "Worth going live",
  Busy: "Proceed carefully",
  Oversaturated: "Wait for pressure to ease",
};

function App() {
  const [pulse, setPulse] = useState<PulseData>(loadingPulse);

  useEffect(() => {
    let isMounted = true;

    const loadPulse = async () => {
      try {
        const response = await fetch("/api/pulse", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          if (isMounted) setPulse(errorPulse(payload?.detail || payload?.error || "Blaze API is unavailable."));
          return;
        }
        const nextPulse = payload as PulseData;
        if (isMounted) setPulse(nextPulse);
      } catch (error) {
        if (isMounted) setPulse(errorPulse(error instanceof Error ? error.message : "Blaze API is unavailable."));
      }
    };

    void loadPulse();
    const intervalId = window.setInterval(loadPulse, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <PulseContext.Provider value={pulse}>
      <main>
        <LandingPage />
        <DashboardPage />
      </main>
    </PulseContext.Provider>
  );
}

function errorPulse(message: string): PulseData {
  return {
    ...loadingPulse,
    status: "error",
    state: "Oversaturated",
    recommendation: "Hold for now",
    recommendationDetail: "Live Blaze ecosystem data is unavailable. Waiting is safer than acting on stale information.",
    lastUpdated: "Unavailable",
    error: message,
    signals: [
      { label: "Blaze API", value: "Unavailable", tone: "negative", detail: message },
    ],
  };
}

function usePulse() {
  return useContext(PulseContext);
}

function hasLiveCreators(pulse: PulseData) {
  return pulse.metrics.some((metric) => metric.label === "Live creators" && metric.value !== "0");
}

function LandingPage() {
  const pulse = usePulse();
  const isLive = pulse.status === "ready" || pulse.status === "stale";
  const statusText = isLive ? "Live ecosystem" : pulse.status === "error" ? "Ecosystem offline" : "Syncing ecosystem";

  return (
    <section className="landing" id="top" aria-labelledby="hero-title">
      <div className="top-nav">
        <a className="brand" href="#top" aria-label="Blaze Pulse home">
          <span className="brand-mark"><Flame size={18} /></span>
          <span>Blaze Pulse</span>
        </a>
        <a className="nav-action" href="#dashboard">
          Open dashboard <ArrowRight size={16} />
        </a>
      </div>

      <div className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">Live ecosystem timing</p>
          <h1 id="hero-title">Blaze Pulse</h1>
          <p className="tagline">Know the perfect moment to go live.</p>
          <p className="hero-text">
            A premium control room for the Blaze ecosystem. One decisive signal, tuned for creators asking whether now is the right moment.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#dashboard">
              Check the pulse <Zap size={17} />
            </a>
            <span className="status-pill"><Radio size={15} /> {statusText}</span>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="radar-stage">
            <div className="radar-ring ring-one" />
            <div className="radar-ring ring-two" />
            <div className="radar-ring ring-three" />
            <div className="radar-sweep" />
            <div className="radar-core">
              <span>{pulse.score}</span>
              <small>{pulse.state}</small>
            </div>
            <i className="pulse-dot dot-a" />
            <i className="pulse-dot dot-b" />
            <i className="pulse-dot dot-c" />
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardPage() {
  return (
    <section className="dashboard" id="dashboard" aria-label="Blaze Pulse dashboard">
      <div className="dashboard-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Blaze ecosystem</p>
            <h2>Should I go live now?</h2>
          </div>
          <LastUpdated />
        </header>

        <div className="dashboard-grid">
          <OpportunityPanel />
          <RecommendationCard />
          <SignalsPanel />
          <CategoryMomentum />
          <CompetitionPressure />
          <LiveMetrics />
          <Timeline24h />
        </div>
      </div>
    </section>
  );
}

function LastUpdated() {
  const pulse = usePulse();

  return (
    <div className="last-updated">
      <span className="live-dot" />
      <div>
        <span>Last updated</span>
        <strong>{pulse.lastUpdated}</strong>
      </div>
    </div>
  );
}

function OpportunityPanel() {
  const pulse = usePulse();
  const tone = stateTone(pulse.state);

  return (
    <section className="panel opportunity-panel" aria-labelledby="opportunity-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Opportunity gauge</p>
          <h3 id="opportunity-title" className={`tone-text-${tone}`}>{pulse.state}</h3>
        </div>
        <Gauge size={22} />
      </div>
      <div className="gauge-wrap">
        <OpportunityGauge score={pulse.score} state={pulse.state} />
      </div>
      <div className={`state-caption state-${pulse.state.toLowerCase()}`}>
        <strong>{stateCopy[pulse.state]}</strong>
        <span>Opportunity is reading {pulse.score}/100 from live ecosystem pressure.</span>
      </div>
    </section>
  );
}

function OpportunityGauge({ score, state }: { score: number; state: PulseState }) {
  const angle = -126 + score * 2.52;
  return (
    <div className={`opportunity-gauge state-${state.toLowerCase()}`} aria-label={`Opportunity score ${score}, ${state}`}>
      <div className="gauge-arc" />
      <div className="gauge-track" />
      <div className="gauge-needle" style={{ transform: `rotate(${angle}deg)` }} />
      <div className="gauge-center">
        <span>{score}</span>
        <small>{state}</small>
      </div>
      <div className="gauge-label label-low">Wait</div>
      <div className="gauge-label label-high">Live</div>
    </div>
  );
}

function RecommendationCard() {
  const pulse = usePulse();
  const recommendationTone = stateTone(pulse.state);

  return (
    <section className="panel recommendation-card" aria-labelledby="recommendation-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Smart recommendation</p>
          <h3 id="recommendation-title" className={`tone-text-${recommendationTone}`}>{pulse.recommendation}</h3>
        </div>
        <Sparkles size={22} />
      </div>
      <p>{pulse.recommendationDetail}</p>
      <div className="recommendation-row">
        <span>Confidence</span>
        <strong>High</strong>
      </div>
      <div className="skeleton-strip" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function SignalsPanel() {
  const pulse = usePulse();
  const title = pulse.status !== "ready" && pulse.status !== "stale"
    ? "Live feed unavailable"
    : !hasLiveCreators(pulse)
      ? "Awaiting live activity"
      : pulse.state === "Prime" || pulse.state === "Good"
        ? "Why now looks strong"
        : pulse.state === "Busy"
          ? "Why timing is mixed"
          : "Why now looks crowded";

  return (
    <section className="panel signals-panel" aria-labelledby="signals-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Ecosystem signals</p>
          <h3 id="signals-title">{title}</h3>
        </div>
        <Activity size={22} />
      </div>
      <div className="signal-list">
        {pulse.signals.map((signal) => (
          <article className={`signal-card tone-${signal.tone}`} key={signal.label}>
            <span>{signal.label}</span>
            <strong>{signal.value}</strong>
            <p>{signal.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CategoryMomentum() {
  const pulse = usePulse();
  const title = pulse.categories.length > 0 ? "Attention\u00a0is\u00a0moving" : "Awaiting category data";

  return (
    <section className="panel category-panel" aria-labelledby="category-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Category momentum</p>
          <h3 id="category-title" className={pulse.categories.length > 0 ? "motion-title" : undefined}>{title}</h3>
        </div>
        <TrendingUp size={22} />
      </div>
      <div className="category-list">
        {pulse.categories.length === 0 && (
          <article className="category-row empty-row">
            <div>
              <strong>No category data</strong>
              <span>Waiting for a verified Blaze snapshot</span>
            </div>
          </article>
        )}
        {pulse.categories.map((category) => (
          <article className="category-row" key={category.name}>
            <div>
              <strong>{category.name}</strong>
              <span>{category.viewers} viewers / {category.creators} live</span>
            </div>
            <div className="momentum-bar" aria-label={`${category.name} momentum ${category.momentum}`}>
              <span style={{ width: `${category.momentum}%` }} />
            </div>
            <TrendingUp className={category.momentum >= 50 ? "trend-positive" : "trend-neutral"} size={18} />
          </article>
        ))}
      </div>
    </section>
  );
}

function CompetitionPressure() {
  const pulse = usePulse();
  const pressureTone = pulse.pressure.index >= 50 ? "negative" : pulse.pressure.index <= 45 ? "positive" : "warning";

  return (
    <section className="panel pressure-panel" aria-labelledby="pressure-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Competition pressure</p>
          <h3 id="pressure-title" className={`tone-text-${pressureTone}`}>{pulse.pressure.label}</h3>
        </div>
        <Users size={22} />
      </div>
      <div className={`pressure-meter tone-${pressureTone}`}>
        <span style={{ width: `${pulse.pressure.index}%` }} />
      </div>
      <div className="pressure-grid">
        <MetricMini label="Pressure index" value={`${pulse.pressure.index}/100`} tone={pulse.pressure.index >= 70 ? "negative" : pulse.pressure.index <= 45 ? "positive" : "neutral"} />
        <MetricMini label="Creator velocity" value={pulse.pressure.creatorVelocity} tone={toneFromSignedValue(pulse.pressure.creatorVelocity)} />
        <MetricMini label="Open window" value={pulse.pressure.openWindow} />
      </div>
    </section>
  );
}

function LiveMetrics() {
  const pulse = usePulse();

  return (
    <section className="panel metrics-panel" aria-labelledby="metrics-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live ecosystem metrics</p>
          <h3 id="metrics-title">Current state</h3>
        </div>
        <Radio size={22} />
      </div>
      <div className="metrics-grid">
        {pulse.metrics.map((metric) => (
          <MetricMini key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} tone={metric.tone} deltaTone={metric.deltaTone} />
        ))}
      </div>
    </section>
  );
}

function MetricMini({ label, value, delta, tone = "neutral", deltaTone }: Metric) {
  return (
    <article className={`metric-mini tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {delta && <em className={`delta-${deltaTone || toneFromSignedValue(delta)}`}>{delta}</em>}
    </article>
  );
}

function toneFromSignedValue(value: string): Tone {
  if (value.startsWith("+") && value !== "+0%") return "positive";
  if (value.startsWith("-") && value !== "-0%") return "negative";
  return "neutral";
}

function stateTone(state: PulseState): Tone {
  if (state === "Prime" || state === "Good") return "positive";
  if (state === "Busy") return "negative";
  return "warning";
}

function Timeline24h() {
  const pulse = usePulse();
  const timeline = pulse.timeline.length > 1 ? pulse.timeline : emptyTimeline;
  const hasMomentum = pulse.timeline.some((point) => point.score > 0) && hasLiveCreators(pulse);
  const title = pulse.status !== "ready" && pulse.status !== "stale"
    ? "Awaiting momentum data"
    : hasMomentum
      ? "Opportunity rising"
      : "Awaiting momentum data";
  const points = timeline.map((point, index) => {
    const x = (index / (timeline.length - 1)) * 100;
    const y = 100 - point.score;
    return `${x},${y}`;
  }).join(" ");

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">24-hour momentum timeline</p>
          <h3 id="timeline-title">{title}</h3>
        </div>
        <Clock3 size={22} />
      </div>
      <div className="timeline-chart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="24 hour opportunity score trend">
          <polyline points={points} />
        </svg>
        <div className="timeline-bars">
          {timeline.map((point) => (
            <span key={point.hour} style={{ height: `${Math.max(14, point.score)}%` }} title={`${point.hour}:00 score ${point.score}`} />
          ))}
        </div>
      </div>
      <div className="timeline-labels">
        <span>24h low {Math.min(...timeline.map((point) => point.score))}</span>
        <strong>Now {pulse.score}</strong>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
