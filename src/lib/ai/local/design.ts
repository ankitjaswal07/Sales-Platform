import type { ConceptSection, PaletteToken } from "../../types";
import type { AIFeatureContext, ConceptPreset, DesignRecommendation, GeneratedConcept, WireframeBlock } from "../types";
import { industryProfile } from "./industry";

/* ── Palette library ─────────────────────────────────────────────────────── */

interface PaletteDefinition {
  name: string;
  mood: string[];
  colors: (brand?: string) => PaletteToken[];
  typography: { heading: string; body: string; rationale: string };
  layout: string;
  radius: string;
  shadows: string;
}

const PALETTES: Record<ConceptPreset, PaletteDefinition> = {
  premium: {
    name: "Deep navy & warm accent",
    mood: ["Confident", "Considered", "Established"],
    colors: (brand) => [
      { name: "Primary", hex: brand ?? "#101a35", usage: "Headers, footer, primary buttons and section anchors" },
      { name: "Surface", hex: "#ffffff", usage: "Page background and card surfaces" },
      { name: "Accent", hex: "#c8963e", usage: "Primary CTA, active states, score highlights (used sparingly)" },
      { name: "Support", hex: "#4a5a7a", usage: "Secondary text, borders, iconography" },
      { name: "Ink", hex: "#0b1220", usage: "Headings and high-contrast text" },
    ],
    typography: { heading: "Söhne / Inter Display", body: "Inter", rationale: "A precise grotesque with real weight contrast — reads as engineered rather than decorative." },
    layout: "12-column grid, generous 96px vertical rhythm, asymmetric hero with proof panel",
    radius: "8px — restrained, precise",
    shadows: "Two-step elevation, very low opacity, no glow",
  },
  minimal: {
    name: "Monochrome & charcoal",
    mood: ["Quiet", "Confident", "Content-first"],
    colors: () => [
      { name: "Primary", hex: "#141414", usage: "Type, primary buttons, rules" },
      { name: "Surface", hex: "#fafafa", usage: "Background with white cards" },
      { name: "Accent", hex: "#0f62fe", usage: "Links and one single focal CTA (only one per page)" },
      { name: "Support", hex: "#6f6f6f", usage: "Secondary copy and metadata" },
      { name: "Border", hex: "#e2e2e2", usage: "Hairline dividers instead of boxes" },
    ],
    typography: { heading: "Inter Tight", body: "Inter", rationale: "Neutral, highly legible, gets out of the way of the content." },
    layout: "Single column, 640–720px measure, wide margins, hairline rules between sections",
    radius: "4px — minimal",
    shadows: "None — separation achieved with hairlines and spacing",
  },
  corporate: {
    name: "Corporate blue & slate",
    mood: ["Credible", "Structured", "Formal"],
    colors: () => [
      { name: "Primary", hex: "#0b3a6f", usage: "Header, primary buttons, table headers" },
      { name: "Surface", hex: "#ffffff", usage: "Background with #f4f6f9 banded sections" },
      { name: "Accent", hex: "#1f7ae0", usage: "Interactive states and links" },
      { name: "Support", hex: "#5a6b80", usage: "Body copy and captions" },
      { name: "Success", hex: "#1f7a4d", usage: "Accreditation and compliance indicators" },
    ],
    typography: { heading: "IBM Plex Sans", body: "IBM Plex Sans", rationale: "Engineered and institutional; carries tables and specification content well." },
    layout: "Module-based grid with banded full-width sections and a specification table pattern",
    radius: "6px — structured",
    shadows: "Flat with 1px borders; elevation reserved for modals",
  },
  modern: {
    name: "Indigo gradient & electric accent",
    mood: ["Contemporary", "Energetic", "Digital-native"],
    colors: () => [
      { name: "Primary", hex: "#4f46e5", usage: "Primary buttons, active navigation, data accents" },
      { name: "Primary deep", hex: "#312e81", usage: "Hero gradient end, footer" },
      { name: "Surface", hex: "#ffffff", usage: "Cards on a #f8fafc page" },
      { name: "Accent", hex: "#22d3ee", usage: "Progress, highlight, one accent detail per view" },
      { name: "Ink", hex: "#0f172a", usage: "Headings" },
    ],
    typography: { heading: "Manrope", body: "Inter", rationale: "Geometric headings with a neutral body — modern without being fashionable-in-six-months." },
    layout: "Bento-style modular grid, large type scale, subtle gradient mesh background",
    radius: "16px — contemporary",
    shadows: "Soft, coloured tint at low opacity for interactive surfaces",
  },
  luxury: {
    name: "Charcoal, ivory & brass",
    mood: ["Editorial", "Restrained", "Expensive"],
    colors: () => [
      { name: "Primary", hex: "#1b1b1b", usage: "Full-bleed sections and type" },
      { name: "Surface", hex: "#f7f4ef", usage: "Warm ivory background" },
      { name: "Accent", hex: "#b08d57", usage: "Hairlines, small caps labels, single CTA outline" },
      { name: "Support", hex: "#6b6459", usage: "Secondary copy" },
      { name: "Deep", hex: "#0d0d0d", usage: "Immersive image overlays" },
    ],
    typography: { heading: "Canela / Cormorant Garamond", body: "Söhne / Inter", rationale: "A serif display against a clean sans body creates the editorial contrast luxury brands rely on." },
    layout: "Full-bleed imagery, wide letter-spaced small caps, deliberate asymmetry, lots of negative space",
    radius: "0–2px — sharp, architectural",
    shadows: "None; contrast and imagery carry the hierarchy",
  },
  brand_colors: {
    name: "Agency brand palette",
    mood: ["Brand-consistent", "Professional", "Familiar"],
    colors: (brand) => [
      { name: "Brand primary", hex: brand ?? "#5b5bd6", usage: "Buttons, links, active states, brand moments" },
      { name: "Neutral base", hex: "#ffffff", usage: "Primary surface" },
      { name: "Neutral ink", hex: "#111827", usage: "Type and dark sections" },
      { name: "Neutral mid", hex: "#6b7280", usage: "Secondary copy and borders" },
      { name: "Tint", hex: "#eef2ff", usage: "Soft section backgrounds and callout panels" },
    ],
    typography: { heading: "Geist", body: "Geist", rationale: "Aligned with the agency's own product typography so deliverables feel like one family." },
    layout: "Standard conversion layout using the agency design tokens for radius, spacing and elevation",
    radius: "Matches agency system (12px)",
    shadows: "Agency system elevation",
  },
  playful: {
    name: "Warm coral & saffron",
    mood: ["Friendly", "Approachable", "Human"],
    colors: () => [
      { name: "Primary", hex: "#ef5a3c", usage: "Primary CTA and accents" },
      { name: "Surface", hex: "#fffdf9", usage: "Warm off-white background" },
      { name: "Secondary", hex: "#f6a723", usage: "Highlights and illustration accents" },
      { name: "Ink", hex: "#2b2118", usage: "Type" },
      { name: "Success", hex: "#2f9e6b", usage: "Win states and confirmations" },
    ],
    typography: { heading: "DM Sans", body: "DM Sans", rationale: "Rounded, geometric and warm — friendly without losing legibility." },
    layout: "Rounded cards, staggered image clusters, generous illustration slots",
    radius: "20px — soft and friendly",
    shadows: "Visible but soft elevation for a tactile feel",
  },
  technical: {
    name: "Graphite & signal green",
    mood: ["Precise", "Data-driven", "Engineering-led"],
    colors: () => [
      { name: "Primary", hex: "#1f2933", usage: "Chrome, headers, tables" },
      { name: "Surface", hex: "#f5f7fa", usage: "Data surfaces" },
      { name: "Accent", hex: "#00a37a", usage: "Positive metrics and primary CTA" },
      { name: "Warn", hex: "#d97706", usage: "Attention and out-of-range metrics" },
      { name: "Mono", hex: "#334e68", usage: "Technical labels and code" },
    ],
    typography: { heading: "IBM Plex Sans", body: "IBM Plex Sans", rationale: "Engineered typography that handles numerals and technical labels cleanly." },
    layout: "Dense specification grid with comparison tables and supporting diagrams",
    radius: "4px — functional",
    shadows: "1px borders, minimal elevation",
  },
};

/* ── Style modifiers applied by the Regenerate / Improve actions (§10) ───── */

const PRESET_DIRECTIVES: Record<ConceptPreset, string> = {
  premium: "Elevate perceived value: reduce colour, increase space, add deliberate weight contrast in headings and keep motion minimal and slow.",
  minimal: "Remove. Fewer colours, more space, hairlines instead of boxes, and let the content set the rhythm.",
  corporate: "Add structure: introduce a credential band, a comparison or specification module, and a formal case-study block.",
  modern: "Increase typographic scale, introduce a single gradient moment in the hero, and use a modular bento layout for services.",
  luxury: "Introduce an editorial serif, sharp corners, full-bleed photography and wider letter-spacing on labels.",
  brand_colors: "Re-map the palette to the agency's brand tokens and align radius and elevation with the agency design system.",
  playful: "Warm the palette, round the corners, add friendly illustration slots and lighten the tone of the microcopy.",
  technical: "Add specification tables, a comparison module and metric-led case studies with precise, substantiated numbers.",
};

export function localDesignRecommendation(ctx: AIFeatureContext, preset: ConceptPreset = "premium"): GeneratedConcept {
  const profile = industryProfile(ctx.industry, null);
  const palette = PALETTES[preset] ?? PALETTES.premium;
  const scores = ctx.scores ?? {};
  const findings = ctx.findings ?? [];
  const critical = findings.filter((f) => f.severity === "critical");
  const brand = ctx.brandColors?.[0];

  const colors = palette.colors(brand);
  const sections = buildSections(profile, ctx, preset);
  const wireframe = buildWireframe(sections);

  const heroHeadline = buildHeroHeadline(ctx, profile);
  const subheadline = buildHeroSubheadline(ctx, profile, scores);

  const recommendation: GeneratedConcept = {
    style: `${palette.name} · ${profile.designStyle}`,
    styleRationale: `${PRESET_DIRECTIVES[preset]} For ${profile.label.toLowerCase()}, ${palette.typography.rationale.toLowerCase()} ${palette.layout.toLowerCase()}.`,
    mood: palette.mood,
    palette: colors,
    typography: palette.typography,
    layout: palette.layout,
    hero: {
      headline: heroHeadline,
      subheadline,
      cta: profile.primaryCta,
      secondaryCta: profile.secondaryCta,
      notes: `Full-width hero with ${profile.imagery[0].toLowerCase()} as the background or split panel. Headline max 8 words at desktop scale (clamp 2.4–3.6rem). ${profile.primaryCta} sits above the fold on desktop and in a sticky bar on mobile. Trust strip immediately beneath the hero: ${
        ctx.rating ? `${ctx.rating.toFixed(1)}★ from ${ctx.reviewCount ?? 0} reviews` : `${ctx.reviewCount ?? 0} reviews`
      }${profile.trustSignals[0] ? `, ${profile.trustSignals[0].toLowerCase()}` : ""}.`,
    },
    navigation: buildNavigation(profile),
    sections,
    contentStructure: profile.mustHaveSections.map((name) => ({
      page: name,
      purpose: sectionPurpose(name, profile),
      keyElements: [
        name === "FAQ" ? "6–10 objection-led questions with schema markup" : `Primary heading stating the outcome for the customer`,
        `Specific proof or detail — no generic filler`,
        `Contextual ${profile.primaryCta} where commercially appropriate`,
      ],
    })),
    images: profile.imagery,
    icons: profile.icons,
    animations: buildAnimations(preset),
    conversionStrategy: buildConversionStrategy(profile, ctx, critical.length),
    pages: buildPageList(profile),
    features: [...profile.mustHaveFeatures, ...profile.optionalFeatures.slice(0, 3)],
    designNotes: buildDesignNotes(preset, profile, palette, ctx),
    accessibilityNotes: [
      "Body text meets WCAG AA contrast (4.5:1) against every surface in the palette.",
      "All interactive targets are at least 44×44px on touch devices.",
      "Visible focus states on every interactive element; no suppression of default outlines.",
      "Form fields use programmatically associated labels — placeholders never substitute for labels.",
      "Motion respects prefers-reduced-motion; nothing essential depends on animation.",
      "Every image carries either meaningful alt text or an empty alt for decorative use.",
    ],
    generatedBy: "local_engine",
    preset,
    preview: {
      wireframe,
      heroPreview: { headline: heroHeadline, subheadline, cta: profile.primaryCta, palette: colors.slice(0, 4).map((c) => c.hex) },
    },
    changeSummary: PRESET_DIRECTIVES[preset],
  };

  return recommendation;
}

function buildSections(profile: ReturnType<typeof industryProfile>, ctx: AIFeatureContext, preset: ConceptPreset): ConceptSection[] {
  const locality = ctx.city ?? "your area";
  const sections: ConceptSection[] = [
    {
      name: "Hero",
      purpose: `Answer "am I in the right place, and can I act now?" within three seconds.`,
      content: [
        `Headline stating the outcome: ${buildHeroHeadline(ctx, profile)}`,
        `Supporting line naming the location and the service: serving ${locality}`,
        `Primary action: ${profile.primaryCta}`,
        `Trust strip: ${ctx.rating ? `${ctx.rating.toFixed(1)}★` : "review rating"}, ${ctx.reviewCount ?? 0} reviews${profile.trustSignals[0] ? `, ${profile.trustSignals[0]}` : ""}`,
      ],
      layout: "Split hero — copy left, single strong image right — collapsing to stacked copy over image on mobile with a sticky CTA bar",
    },
    {
      name: "Trust indicators",
      purpose: "Remove the perceived risk of contacting an unfamiliar business before asking for anything.",
      content: profile.trustSignals.map((t) => `Display: ${t}`),
      layout: "Horizontal strip of 4 credibility items with monochrome icon treatment; wraps to 2×2 on mobile",
    },
    {
      name: "Services",
      purpose: "Let the visitor self-select the exact service they came for, in the language they searched with.",
      content: profile.mustHaveSections.includes("Services & capabilities")
        ? [`Grouped service cards with one-line outcome each`, `Each card links to a dedicated detail page`, `Contextual CTA on each card`]
        : [`Core service list with outcome-led headings`, `Pricing or "from £X" guidance where honest`, `Link to the most commercially valuable service`],
      layout: "3-column card grid on desktop, single column on mobile, 24px gutters",
    },
    {
      name: "Why choose us",
      purpose: "Differentiate on the things this buyer actually weighs: proof, guarantees and process.",
      content: [
        `Three to four substantiated differentiators — no superlatives`,
        `Named team or founder presence with a real photograph`,
        `Guarantee or warranty statement in plain language`,
      ],
      layout: "Alternating two-column image/text rows with generous vertical rhythm",
    },
    {
      name: "Proof",
      purpose: `Show ${profile.label.toLowerCase()} buyers evidence from people like them.`,
      content: [
        ctx.rating && (ctx.reviewCount ?? 0) > 0
          ? `Google review summary: ${ctx.rating.toFixed(1)}★ from ${ctx.reviewCount} reviews, linking to the live listing`
          : "Verified reviews pulled from the business's public listing",
        "Three named testimonials with project context (and photographs where consented)",
        "Accreditations, insurance levels and certification numbers",
      ],
      layout: "Two-column: testimonial carousel with real names beside an accreditation grid",
    },
    {
      name: profile.key === "restaurant" || profile.key === "landscaping" || profile.key === "beauty" ? "Gallery" : "Work / results",
      purpose: "Provide visual evidence that is difficult to fake and easy to judge.",
      content: profile.key === "construction" || profile.key === "landscaping"
        ? ["Before/after pairs shot from an identical angle", "Filterable by project type", "Each project opens a short case study with scope and outcome"]
        : ["Consistent, well-lit photography", "Filterable or browsable by category", "Each item links to detail with context"],
      layout: "Masonry grid with lightbox; 2 columns on mobile",
    },
    {
      name: "Process",
      purpose: "Reduce uncertainty about what happens after making contact.",
      content: ["Numbered 3–5 step process", "Realistic time expectations per step", "What the customer needs to prepare"],
      layout: "Numbered vertical timeline on mobile, horizontal steps with connector line on desktop",
    },
    {
      name: "FAQ",
      purpose: "Handle the objections that stop people contacting you.",
      content: [
        "Price expectation and what affects it",
        "How quickly you respond and what happens next",
        "Coverage area and availability",
        "The single most common worry in this sector",
      ],
      layout: "Accordion with FAQPage structured data; answer text always present in the DOM",
    },
    {
      name: "Primary conversion block",
      purpose: "Give a decisive visitor an unmissable, low-friction way to act.",
      content: [
        profile.primaryCta,
        "Short form: name, one contact method, requirement",
        "Response-time promise: 'we reply within 2 working hours'",
      ],
      layout: "Full-width contrasting band with the form beside the promise copy",
    },
    {
      name: "Contact & location",
      purpose: "Serve the highest-intent visitor who is ready to call or visit.",
      content: ["Click-to-call phone number", "Full address with map embed", "Opening hours", "Insurance and registration details"],
      layout: "Two columns: details and hours beside a live map; stacked on mobile",
    },
    {
      name: "Footer",
      purpose: "Reinforce credibility and give search engines clean crawl paths.",
      content: ["Full service list with links", "Accreditations repeated", "Copyright with the current year", "Privacy and cookie policy links"],
      layout: "Four-column link grid collapsing to accordion on mobile",
    },
  ];

  if (preset === "corporate" || preset === "technical") {
    sections.splice(6, 0, {
      name: "Specification / comparison",
      purpose: "Let a considered buyer compare options without calling you first.",
      content: ["Comparison table of service tiers or systems", "Clear 'included / not included' rows", "Recommended option highlighted with a reason"],
      layout: "Responsive table that becomes stacked cards below 720px",
    });
  }
  if (preset === "luxury") {
    sections.splice(1, 0, {
      name: "Editorial statement",
      purpose: "Set the standard before showing the work.",
      content: ["Single large display sentence", "Generous whitespace", "No button — the intent is atmosphere, not action"],
      layout: "Full-bleed quiet band with centred display serif type",
    });
  }

  return sections;
}

function buildWireframe(sections: ConceptSection[]): WireframeBlock[] {
  return sections.map((section, index) => ({
    id: `wf-${index}`,
    label: section.name,
    columns: (section.name === "Services" ? 3 : section.name === "Trust indicators" ? 4 : section.name === "Hero" ? 2 : 1) as 1 | 2 | 3 | 4,
    height: (section.name === "Hero" ? "xl" : ["Proof", "Gallery", "Work / results"].includes(section.name) ? "lg" : "md") as WireframeBlock["height"],
    notes: section.layout,
  }));
}

function buildHeroHeadline(ctx: AIFeatureContext, profile: ReturnType<typeof industryProfile>): string {
  const locality = ctx.city ?? null;
  const templates: Record<string, string[]> = {
    dental: [`A Dentist In ${locality ?? "Your Area"} Worth Smiling About`, "Dentistry That Puts You At Ease"],
    construction: [`Extensions, Renovations & Builds Across ${locality ?? "Your Region"}`, "Built Properly. On Time. On Budget."],
    restaurant: [`Fresh Food, Warm Welcome${locality ? ` — ${locality}` : ""}`, "Book Your Table Direct"],
    real_estate: [`Find Your Next Home In ${locality ?? "Your Area"}`, "Local Property Expertise, Honest Advice"],
    plumbing: [`Emergency Plumber In ${locality ?? "Your Area"} — Usually On Site Within The Hour`, "Heating & Plumbing You Can Rely On"],
    hvac: [`Air Conditioning & Heating Specialists${locality ? ` In ${locality}` : ""}`, "Climate Comfort, Engineered Properly"],
    legal: [`Clear Legal Advice${locality ? ` In ${locality}` : ""}, Without The Jargon`, "Solicitors Who Explain Every Step"],
    accounting: [`Fixed-Fee Accounting${locality ? ` For ${locality} Businesses` : " For Growing Businesses"}`, "Accountants Who Save You More Than They Cost"],
    medical: [`Expert Care, Close To Home${locality ? ` In ${locality}` : ""}`, "Appointments That Fit Your Life"],
    automotive: [`Your Local Garage${locality ? ` In ${locality}` : ""} — Booked Online In Minutes`, "Servicing & MOT Without The Hassle"],
    landscaping: [`Garden Design & Build${locality ? ` Across ${locality}` : ""}`, "Outdoor Spaces Worth Staying Home For"],
    cleaning: [`Commercial Cleaning${locality ? ` In ${locality}` : ""} You Never Have To Chase`, "Reliable Cleaning, Measurable Standards"],
    fitness: [`Get Stronger${locality ? ` In ${locality}` : ""} — Your First Class Is Free`, "Training That Actually Fits Your Week"],
    beauty: [`Look Your Best${locality ? ` In ${locality}` : ""} — Book Online In 30 Seconds`, "Expert Styling, Effortless Booking"],
    ecommerce: [`Quality ${ctx.industry ?? "Products"} Delivered Fast`, "Shop The Collection"],
    professional_services: [`${ctx.industry ?? "Consultancy"} That Delivers Measurable Outcomes`, "Specialists In What You Actually Need"],
    local_services: [`Trusted ${ctx.industry ?? "Local Specialists"}${locality ? ` In ${locality}` : ""}`, `Local ${ctx.industry ?? "Experts"} You Can Rely On`],
  };
  const options = templates[profile.key] ?? templates.local_services;
  return options[0];
}

function buildHeroSubheadline(ctx: AIFeatureContext, profile: ReturnType<typeof industryProfile>, scores: Record<string, number | null | undefined>): string {
  const locality = ctx.city ?? "the local area";
  const proof =
    ctx.rating && (ctx.reviewCount ?? 0) > 0
      ? `${ctx.rating.toFixed(1)}★ from ${ctx.reviewCount} reviews. `
      : (ctx.reviewCount ?? 0) > 0
        ? `${ctx.reviewCount} reviews from real customers. `
        : "";
  const problem = scores.conversion !== undefined && scores.conversion !== null && scores.conversion < 55
    ? `From enquiry to booked job in three clear steps.`
    : `Get a straight answer, a clear price and a fast response.`;
  return `${proof}${problem} Serving ${locality} and the surrounding areas.`;
}

function buildNavigation(profile: ReturnType<typeof industryProfile>): string[] {
  const base = ["Home", "Services", "Work", "About", "Contact"];
  if (profile.key === "restaurant") return ["Home", "Menus", "Book", "Events", "Find Us"];
  if (profile.key === "ecommerce") return ["Shop", "Collections", "Best Sellers", "About", "Contact"];
  if (profile.key === "real_estate") return ["Home", "Properties", "Valuation", "Landlords", "About", "Contact"];
  if (["legal", "accounting", "professional_services"].includes(profile.key)) return ["Home", "Services", "Sectors", "Insights", "About", "Contact"];
  return base;
}

function buildPageList(profile: ReturnType<typeof industryProfile>): string[] {
  const core = ["Home", "Services", "About", "Contact"];
  const specific: Record<string, string[]> = {
    dental: ["Treatments", "Meet the Team", "New Patients", "Finance", "FAQ"],
    construction: ["Projects", "Extensions", "Commercial", "Process", "Accreditations"],
    restaurant: ["Menus", "Book a Table", "Private Hire", "Find Us", "Gift Vouchers"],
    real_estate: ["Properties", "Free Valuation", "Landlords", "Area Guides", "Meet the Team"],
    plumbing: ["Emergency Callout", "Boiler Installation", "Areas Covered", "Pricing", "Reviews"],
    legal: ["Practice Areas", "Our Team", "Fees", "Case Results", "FAQ"],
    accounting: ["Services", "Packages & Fees", "Sectors", "Deadlines", "Resources"],
    medical: ["Conditions", "Treatments", "Fees & Insurance", "Our Team", "Book"],
    ecommerce: ["Shop", "Collections", "Delivery & Returns", "Size Guide", "Trade"],
    professional_services: ["Services", "Case Studies", "Process", "Insights", "Team"],
  };
  return [...core, ...(specific[profile.key] ?? ["Gallery", "Testimonials", "FAQ", "Areas Covered"])];
}

function sectionPurpose(name: string, profile: ReturnType<typeof industryProfile>): string {
  if (name === "Hero") return "Establish relevance and offer the primary action within three seconds.";
  if (name === "FAQ") return "Resolve the objections that stop people contacting you.";
  if (name === "Proof" || name === "Testimonials") return "Provide third-party evidence that the claims are true.";
  if (name === "Contact & location") return "Convert the highest-intent visitor who is ready to act now.";
  if (name === "Services" || name === "Services & capabilities") return "Let the visitor self-select and land on a page that matches their search.";
  return `Support the ${profile.label.toLowerCase()} buying decision at this stage of the journey.`;
}

function buildAnimations(preset: ConceptPreset): string[] {
  const base = [
    "Section reveal on scroll: 16px rise + fade, 400ms, cubic-bezier(0.22, 1, 0.36, 1), staggered 60ms",
    "Button hover: 2px lift with a 120ms ease, no scale distortion",
    "Sticky header: background blur fades in after 120px of scroll",
    "Image load: 240ms opacity fade with a soft placeholder",
  ];
  if (preset === "luxury") return [base[0], "Slow (700ms) cross-fades for image galleries", "No hover lifts — hairlines animate instead"];
  if (preset === "minimal") return ["Section reveals only. No hover motion. Focus states are the only visual feedback."];
  if (preset === "modern") return [...base, "Gradient mesh drifts 6% over 18s in the hero (background only)"];
  return base;
}

function buildConversionStrategy(profile: ReturnType<typeof industryProfile>, ctx: AIFeatureContext, criticalCount: number): string[] {
  const strategy = [
    `Primary CTA "${profile.primaryCta}" repeated in the header, hero, after proof, and a sticky mobile bar — never more than one dominant action per screen.`,
    `Secondary path "${profile.secondaryCta}" for visitors who are not ready to commit, capturing them as leads.`,
    "Form reduced to three visible fields; additional qualification happens on the call.",
    "Response-time promise stated explicitly next to every form.",
    "Phone number formatted for tap-to-call on mobile in the header and footer.",
    `Trust strip immediately below the hero${ctx.rating ? ` using the ${ctx.rating.toFixed(1)}★ rating and ${ctx.reviewCount} reviews already earned` : " using verified review data"}.`,
    "Every enquiry path instrumented as a conversion event so results are measurable from week one.",
  ];
  if (criticalCount > 0) {
    strategy.push(`Each of the ${criticalCount} critical audit issue${criticalCount === 1 ? "" : "s"} is addressed by a specific section of the new build, so the redesign has a verifiable before/after.`);
  }
  if (profile.primaryConversions.includes("Booking") || profile.primaryConversions.some((c) => /booking|appointment/i.test(c))) {
    strategy.push("Booking widget embedded above the fold with real-time availability — the highest-converting element for appointment-led businesses.");
  }
  return strategy;
}

function buildDesignNotes(
  preset: ConceptPreset,
  profile: ReturnType<typeof industryProfile>,
  palette: PaletteDefinition,
  ctx: AIFeatureContext,
): string {
  return [
    `Design direction: ${palette.name}.`,
    `Mood: ${palette.mood.join(", ").toLowerCase()}.`,
    `Typography pairing: ${palette.typography.heading} for headings against ${palette.typography.body} for body copy.`,
    `Layout: ${palette.layout}.`,
    `Corner radius: ${palette.radius}. Elevation: ${palette.shadows}.`,
    `Imagery direction: ${profile.imagery.join("; ")}.`,
    `Icon set: ${profile.icons.join(", ")} — single-weight line icons at 24px, never mixed with filled icons.`,
    `Microcopy examples for ${ctx.businessName}: ${profile.microCopy.join(" · ")}.`,
    `Structured data: LocalBusiness + ${profile.key === "restaurant" ? "Restaurant/Menu" : profile.key === "medical" ? "MedicalBusiness" : "Service"} schema with aggregateRating sourced from the live listing.`,
  ].join("\n\n");
}
