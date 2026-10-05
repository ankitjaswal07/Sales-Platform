/**
 * Industry knowledge base.
 *
 * This is what makes the local engine's output feel genuinely bespoke rather
 * than templated. For each vertical we know: what the buyer is actually
 * searching for, which sections convert, which features matter, what imagery
 * reads as credible, and the conversion strategy that fits the sales cycle.
 */

export interface IndustryProfile {
  key: string;
  label: string;
  aliases: string[];
  /** What the customer is trying to accomplish. */
  customerIntent: string;
  /** The commercial outcome a better site produces for the business. */
  businessOutcome: string;
  primaryConversions: string[];
  mustHaveSections: string[];
  optionalSections: string[];
  primaryCta: string;
  secondaryCta: string;
  mustHaveFeatures: string[];
  optionalFeatures: string[];
  imagery: string[];
  icons: string[];
  trustSignals: string[];
  keywords: string[];
  designStyle: string;
  microCopy: string[];
}

const PROFILES: IndustryProfile[] = [
  {
    key: "dental",
    label: "Dental & orthodontics",
    aliases: ["dental", "dentist", "orthodont", "implants", "endodont", "periodont", "hygienist"],
    customerIntent: "Patient is comparing local practices, anxious about cost and comfort, and wants to book without a phone call.",
    businessOutcome: "More new-patient registrations and higher-value treatments (implants, aligners, cosmetic) booked directly online.",
    primaryConversions: ["New patient registration", "Appointment booking", "Treatment enquiry", "Emergency call"],
    mustHaveSections: ["Hero with instant booking", "Treatments grid", "Meet the team", "New patient offer", "Patient reviews", "Finance options", "FAQ", "Contact & directions"],
    optionalSections: ["Before & after gallery", "Invisalign/implants landing page", "Emergency dentist banner", "Practice tour video"],
    primaryCta: "Book Your Consultation",
    secondaryCta: "Call Our Practice",
    mustHaveFeatures: ["Online booking integration", "Click-to-call header", "Treatment price guidance", "Financing calculator", "Google reviews embed", "New patient forms", "Directions & parking info"],
    optionalFeatures: ["Live chat", "WhatsApp enquiries", "Patient portal link", "Accessibility widget for reduced-mobility patients"],
    imagery: ["Warm, natural-light practice interior", "Genuine clinician portraits (not stock)", "Patient smiles (with written consent)", "Treatment outcome imagery"],
    icons: ["Tooth", "Calendar", "Shield (safety)", "Star (reviews)", "Sterling/£ (finance)"],
    trustSignals: ["GDC registration numbers", "Practice accreditation badges", "Named clinicians with qualifications", "Verified review count and rating", "Visible treatment guarantees"],
    keywords: ["dentist in {city}", "emergency dentist {city}", "teeth whitening {city}", "implants {city}", "invisalign {city}"],
    designStyle: "Modern Premium Professional",
    microCopy: ["Same-day emergency appointments", "0% finance available", "Registered with the GDC"],
  },
  {
    key: "construction",
    label: "Construction & building",
    aliases: ["construction", "builder", "building", "contractor", "roofing", "civil", "groundwork", "extensions", "joinery"],
    customerIntent: "Homeowner or developer wants proof of quality, licensing and completed projects before requesting a quote.",
    businessOutcome: "Larger average project value and fewer time-wasting enquiries, because the site pre-qualifies on scope and budget.",
    primaryConversions: ["Quote request", "Site survey booking", "Tender enquiry", "Phone call"],
    mustHaveSections: ["Hero with project imagery", "Services & capabilities", "Completed projects gallery", "Accreditations & insurance", "Our process", "Client testimonials", "Obtainable guarantees", "Contact & quote form"],
    optionalSections: ["Before & after project slider", "Sector specialisms (commercial/domestic)", "Meet the team", "Health & safety policy", "Careers"],
    primaryCta: "Request a Free Quote",
    secondaryCta: "Call to Discuss Your Project",
    mustHaveFeatures: ["Project gallery with filters", "Detailed quote form with project type", "Certification badges", "Google Maps coverage area", "Case study template", "Downloadable company credentials PDF"],
    optionalFeatures: ["Client login for live project updates", "Cost estimator", "Drone/flythrough video", "Careers application form"],
    imagery: ["Real completed projects at good light", "Site-in-progress shots showing professionalism", "Team in branded PPE", "Detailed joinery/finish close-ups"],
    icons: ["Hard hat", "Ruler/blueprint", "Shield", "Truck", "Trophy (awards)"],
    trustSignals: ["Memberships (e.g. FMB, CITB)", "Insurance certificate reference", "Named directors", "Contract value range", "Years trading", "Guarantee periods"],
    keywords: ["builders in {city}", "house extension {city}", "roofing company {city}", "loft conversion {city}", "commercial contractor {city}"],
    designStyle: "Premium Corporate Trustworthy",
    microCopy: ["Full public liability insurance", "Free no-obligation site survey", "Fixed-price contracts"],
  },
  {
    key: "restaurant",
    label: "Restaurants & hospitality",
    aliases: ["restaurant", "cafe", "bistro", "pub", "bar", "takeaway", "catering", "bakery", "hotel"],
    customerIntent: "Customer is hungry, on a phone, and wants to see the menu, price, opening hours and a book/order button immediately.",
    businessOutcome: "More direct bookings and orders at full margin, rather than paying 25–30% commission to third-party platforms.",
    primaryConversions: ["Table booking", "Online order", "Menu view", "Directions"],
    mustHaveSections: ["Hero with atmosphere photography", "Menus (with prices)", "Booking widget", "Opening hours", "Location & map", "Food gallery", "Reviews", "Private hire / events"],
    optionalSections: ["Chef story", "Seasonal specials", "Gift vouchers", "Press mentions", "Sustainability sourcing"],
    primaryCta: "Book a Table",
    secondaryCta: "View Our Menu",
    mustHaveFeatures: ["Booking integration", "Mobile-first menu with prices", "Google Maps + directions", "Click-to-call", "Allergen information", "Social feed embed", "Order-online link"],
    optionalFeatures: ["Gift voucher purchase", "Email newsletter signup", "Loyalty scheme", "Event enquiry form", "Table availability widget"],
    imagery: ["Signature dishes shot in daylight", "Interior atmosphere at dinner service", "Team at front of house", "Ingredients or sourcing story"],
    icons: ["Fork & knife", "Clock (hours)", "Map pin", "Calendar", "Star"],
    trustSignals: ["Real review counts and rating", "Food hygiene rating", "Named chef/host", "Years established", "Press/awards"],
    keywords: ["restaurants in {city}", "book a table {city}", "best {cuisine} {city}", "brunch {city}", "private dining {city}"],
    designStyle: "Editorial Warm Hospitality",
    microCopy: ["Walk-ins welcome", "Book direct — no booking fees", "Allergen menu available"],
  },
  {
    key: "real_estate",
    label: "Real estate & lettings",
    aliases: ["real estate", "estate agent", "property", "lettings", "realtor", "landlord", "property management", "mortgage"],
    customerIntent: "Buyer/tenant/seller wants instant access to accurate listings, valuations and a way to book a viewing.",
    businessOutcome: "More vendor/landlord instructions and qualified viewer bookings, driven by instant valuation capture.",
    primaryConversions: ["Property valuation request", "Viewing booking", "Listing enquiry", "Landlord enquiry"],
    mustHaveSections: ["Hero with property search", "Featured listings", "Instant valuation CTA", "Selling process", "Landlord services", "Area guides", "Agent profiles", "Reviews", "Contact"],
    optionalSections: ["Sold-to-asking price statistics", "Market reports", "Mortgage calculator", "Relocation guides", "Tenant fees policy"],
    primaryCta: "Get a Free Valuation",
    secondaryCta: "Book a Viewing",
    mustHaveFeatures: ["Property search with map", "Valuation lead capture", "Viewing booking", "Email alerts for saved searches", "Mortgage calculator", "Floorplans & virtual tours", "WhatsApp enquiries"],
    optionalFeatures: ["Client portal for landlords", "Rental yield calculator", "Downloadable property brochures", "Automated valuation follow-up sequence"],
    imagery: ["Professional property photography", "Agent headshots", "Local area imagery", "Twilight exteriors for premium stock"],
    icons: ["Home", "Key", "Map pin", "Chart (market data)", "Calculator"],
    trustSignals: ["Ombudsman / property redress membership", "Client money protection", "Deposit protection scheme details", "Sales figures and completion rates", "Named agents with photos"],
    keywords: ["estate agents in {city}", "houses for sale {city}", "letting agents {city}", "free property valuation {city}", "apartments to rent {city}"],
    designStyle: "Modern Premium Professional",
    microCopy: ["Free, no-obligation valuation", "Accompanied viewings seven days a week", "Client money protected"],
  },
  {
    key: "plumbing",
    label: "Plumbing & heating",
    aliases: ["plumbing", "plumber", "heating", "boiler", "drainage", "gas engineer", "bathroom fitter"],
    customerIntent: "Often an emergency on a mobile device — needs an immediate phone number, coverage area, price expectation and a promise of speed.",
    businessOutcome: "Higher share of emergency call-outs and boiler/boiler-replacement jobs, which are the highest-margin work.",
    primaryConversions: ["Emergency call", "Boiler quote", "Service booking", "Online enquiry"],
    mustHaveSections: ["Hero with emergency call button", "Services list", "Emergency/24-7 banner", "Coverage areas by town", "Transparent pricing", "Gas Safe / certification proof", "Reviews", "Contact form"],
    optionalSections: ["Boiler replacement finance", "Maintenance plans", "Meet the team", "Landlord certificates", "Helpful advice blog"],
    primaryCta: "Call Now — 24/7 Emergency",
    secondaryCta: "Request a Boiler Quote",
    mustHaveFeatures: ["Sticky click-to-call", "Coverage-area town pages", "Transparent price list", "Online booking for services", "WhatsApp enquiries", "Landlord certificate request form"],
    optionalFeatures: ["Live engineer tracking", "Service plan signup and payment", "Finance application", "Warranty registration lookup"],
    imagery: ["Engineer in branded van/uniform", "Neat pipework and finished bathrooms", "Team with certification cards", "Before/after boiler installations"],
    icons: ["Wrench", "Flame (boiler)", "Phone", "Clock (24/7)", "Shield (Gas Safe)"],
    trustSignals: ["Gas Safe registration number", "Insurance details", "Named engineers", "Response-time promise", "Warranty terms", "Review platform badges"],
    keywords: ["plumber in {city}", "emergency plumber {city}", "boiler repair {city}", "new boiler quote {city}", "heating engineer {city}"],
    designStyle: "Bold Functional Trustworthy",
    microCopy: ["Gas Safe registered", "Fixed call-out fee", "Same-day emergency response"],
  },
  {
    key: "hvac",
    label: "HVAC & climate",
    aliases: ["hvac", "air conditioning", "climate", "ventilation", "refrigeration", "heat pump"],
    customerIntent: "Comparing commercial or domestic climate providers on technical competence, service contracts and energy savings.",
    businessOutcome: "More maintenance contract sign-ups, which produce predictable recurring revenue.",
    primaryConversions: ["Service contract enquiry", "Installation quote", "Maintenance booking", "Emergency call"],
    mustHaveSections: ["Hero with commercial credibility", "Domestic & commercial split", "Installation services", "Maintenance plans", "Case studies", "Certifications", "Reviews", "Contact"],
    optionalSections: ["Energy savings calculator", "Brands we fit", "Finance options", "Careers", "Technical documentation downloads"],
    primaryCta: "Book a Free Survey",
    secondaryCta: "See Maintenance Plans",
    mustHaveFeatures: ["Service plan comparison table", "Project case studies with metrics", "Certification display (F-Gas, REFCOM)", "Landlord compliance info", "Quote form with system type", "Online service booking"],
    optionalFeatures: ["Energy savings calculator", "Client portal for compliance docs", "Live chat for urgent faults", "Financing application"],
    imagery: ["Commercial plant rooms looking clean and organised", "Engineers commissioning equipment", "Domestic installs in modern homes", "Certification and compliance close-ups"],
    icons: ["Snowflake", "Sun (heat pump)", "Gauge (efficiency)", "Shield", "Clipboard (compliance)"],
    trustSignals: ["F-Gas certification", "REFCOM membership", "Manufacturer accreditations", "Named contract manager", "Response SLA", "Case study metrics"],
    keywords: ["air conditioning {city}", "hvac maintenance {city}", "heat pump installer {city}", "commercial refrigeration {city}"],
    designStyle: "Technical Corporate",
    microCopy: ["F-Gas certified engineers", "Planned maintenance from £X per unit", "24/7 commercial callout"],
  },
  {
    key: "legal",
    label: "Legal services",
    aliases: ["legal", "solicitor", "law", "attorney", "conveyancing", "family law", "personal injury", "barrister"],
    customerIntent: "Anxious client seeking reassurance about cost, process, discretion and credentials before making contact.",
    businessOutcome: "More qualified instructions and fewer unqualified enquiries, because the site establishes authority and sets expectations.",
    primaryConversions: ["Free consultation request", "Case enquiry", "Call request", "Document upload"],
    mustHaveSections: ["Hero with clear practice positioning", "Practice areas", "Meet the team with credentials", "Our process step-by-step", "Fee structures explained", "Case results", "Accreditations", "FAQ", "Contact"],
    optionalSections: ["Legal guides hub", "Client testimonials", "Insights/blog", "Careers", "Compliance and regulatory info"],
    primaryCta: "Book a Free Consultation",
    secondaryCta: "Call for Immediate Advice",
    mustHaveFeatures: ["Confidential enquiry form", "Secure document upload", "Fee transparency information", "Team profiles with qualifications", "Practice-area landing pages", "Live chat during office hours"],
    optionalFeatures: ["Client portal", "Cost calculator", "Multi-language support", "Automated consultation scheduling"],
    imagery: ["Professional but approachable team portraits", "Office environment conveying discretion", "Abstract architectural detail", "Local landmark references for locality"],
    icons: ["Scales", "Shield", "Document", "Handshake", "Clock"],
    trustSignals: ["SRA / Law Society registration numbers", "Regulated by statements", "Named solicitors with qualification years", "Case results", "Legal Ombudsman membership", "Professional indemnity insurance"],
    keywords: ["solicitors in {city}", "family solicitor {city}", "conveyancing {city}", "employment lawyer {city}", "free legal consultation {city}"],
    designStyle: "Restrained Premium Professional",
    microCopy: ["First consultation free", "Regulated by the SRA", "Strictly confidential"],
  },
  {
    key: "accounting",
    label: "Accounting & bookkeeping",
    aliases: ["accounting", "accountant", "bookkeeping", "tax", "payroll", "cpa", "audit"],
    customerIntent: "Business owner comparing fees and expertise, wanting to understand what is included and how onboarding works.",
    businessOutcome: "More recurring monthly clients at higher average value, with less time spent on discovery calls.",
    primaryConversions: ["Free consultation", "Quote request", "Software/pricing enquiry", "Newsletter signup"],
    mustHaveSections: ["Hero with who you serve", "Services by business stage", "Fixed-fee packages table", "Meet the team", "Software integrations", "Client results", "Deadline help (MTD, self-assessment)", "FAQ", "Contact"],
    optionalSections: ["Sector landing pages", "Tax deadline countdown", "Case studies with numbers", "Resource/guides library", "Careers"],
    primaryCta: "Get a Fixed-Fee Quote",
    secondaryCta: "Book a Discovery Call",
    mustHaveFeatures: ["Package comparison table", "Sector-specific landing pages", "Onboarding form with company details", "Software integration logos (Xero, QuickBooks)", "Deadline reminder signup", "Calendar booking"],
    optionalFeatures: ["Client portal login", "Payroll estimator", "Tax savings calculator", "Automated quote generator"],
    imagery: ["Approachable team portraits", "Modern workspace", "Sector-specific client environments", "Data visualisations for advisory services"],
    icons: ["Calculator", "Chart", "Receipt", "Calendar", "Shield"],
    trustSignals: ["ICAEW / ACCA / AAT memberships", "Professional body numbers", "Client retention statistics", "Named partners", "Software partner badges", "Fixed-fee guarantee"],
    keywords: ["accountants in {city}", "small business accountant {city}", "self assessment {city}", "bookkeeping services {city}", "payroll {city}"],
    designStyle: "Clean Corporate Confident",
    microCopy: ["Fixed monthly fees, no surprises", "Cloud accounting specialists", "Free initial consultation"],
  },
  {
    key: "medical",
    label: "Medical & healthcare",
    aliases: ["medical", "clinic", "healthcare", "physio", "chiropract", "therapy", "gp", "doctor", "veterinary", "vets"],
    customerIntent: "Patient or carer seeking reassurance, availability and a way to book quickly without calling.",
    businessOutcome: "Higher appointment booking rates and reduced administration time taken up by phone enquiries.",
    primaryConversions: ["Appointment booking", "Referral enquiry", "Call", "Insurance information"],
    mustHaveSections: ["Hero with booking", "Conditions treated", "How treatment works", "Meet the practitioners", "Fees & insurance", "Patient stories", "FAQ", "Contact & parking"],
    optionalSections: ["Symptom checker", "Exercise/aftercare resources", "Virtual appointments info", "Workshops & groups", "Accessibility statement"],
    primaryCta: "Book an Appointment",
    secondaryCta: "Call to Speak to Us",
    mustHaveFeatures: ["Online booking with availability", "Insurance provider list", "Fee transparency", "Accessible design (WCAG AA)", "Google reviews embed", "Patient information downloads"],
    optionalFeatures: ["Virtual consultation", "Patient portal", "Automated appointment reminders", "Multi-language support"],
    imagery: ["Calm, well-lit clinical spaces", "Practitioner portraits in professional context", "Equipment imagery", "Accessible facilities"],
    icons: ["Heart", "Calendar", "Shield", "Stethoscope", "Star"],
    trustSignals: ["HCPC / GMC / governing body registration", "Insurance accepted list", "Named practitioners and qualifications", "Patient review count", "GDPR and clinical governance statements"],
    keywords: ["physiotherapy {city}", "private clinic {city}", "chiropractor {city}", "gps near {city}", "vets in {city}"],
    designStyle: "Calm Accessible Professional",
    microCopy: ["Evening and weekend appointments", "Most major insurers accepted", "Registered with the HCPC"],
  },
  {
    key: "automotive",
    label: "Automotive services",
    aliases: ["automotive", "garage", "car", "mot", "tyre", "dealership", "detailing", "bodywork", "vehicle"],
    customerIntent: "Driver needs a service, MOT or repair, and wants to know price, availability and whether they can trust the workshop.",
    businessOutcome: "More booked workshop hours and higher-value jobs, with fewer price-only enquiries.",
    primaryConversions: ["Book a service/MOT", "Get a repair quote", "Call", "Vehicle enquiry"],
    mustHaveSections: ["Hero with booking", "Services & prices", "MOT bookings", "Why choose us", "Manufacturer approvals", "Reviews", "Location & hours", "Contact"],
    optionalSections: ["Vehicle health check explanation", "Fleet services", "Courtesy car info", "Finance/leasing for sales", "Blog with maintenance advice"],
    primaryCta: "Book Your MOT Online",
    secondaryCta: "Get a Repair Quote",
    mustHaveFeatures: ["Online booking by registration", "Price list per service type", "Click-to-call", "Google Maps + directions", "Manufacturer approval badges", "Review integration"],
    optionalFeatures: ["Vehicle lookup by reg plate", "Fleet account portal", "Courtesy car request", "Service history storage"],
    imagery: ["Immaculate workshop bay", "Technicians working on vehicles", "Reception with clear signage", "Completed vehicles"],
    icons: ["Car", "Gauge", "Wrench", "Calendar", "Shield"],
    trustSignals: ["Manufacturer approvals", "Institute of the Motor Industry membership", "Named technicians and qualifications", "Warranty terms", "Independent review count"],
    keywords: ["mot {city}", "car service {city}", "garage near me", "tyres {city}", "car repair {city}"],
    designStyle: "Functional Modern Confident",
    microCopy: ["Free collection and delivery", "Manufacturer-approved parts", "All work guaranteed"],
  },
  {
    key: "landscaping",
    label: "Landscaping & garden",
    aliases: ["landscaping", "gardening", "garden", "paving", "fencing", "grounds maintenance", "tree surgery"],
    customerIntent: "Homeowner wants visible proof of craftsmanship and to understand what a garden/grounds project actually costs.",
    businessOutcome: "Larger design-led projects and maintenance contracts, moving away from small one-off work.",
    primaryConversions: ["Quote request", "Garden design consultation", "Maintenance plan enquiry", "Call"],
    mustHaveSections: ["Hero with dramatic project imagery", "Service categories", "Portfolio with before/after", "Design process", "Maintenance plans", "Testimonials", "Coverage area", "Contact"],
    optionalSections: ["Planting guides", "Seasonal maintenance calendar", "Meet the team", "Awards", "Commercial grounds care"],
    primaryCta: "Request a Free Site Visit",
    secondaryCta: "View Our Projects",
    mustHaveFeatures: ["Before/after project comparisons", "Filterable portfolio", "Detailed quote form", "Coverage-area pages", "Maintenance plan pricing", "Review integration"],
    optionalFeatures: ["Virtual design consultation booking", "3D garden design previews", "Customer project diaries", "Winter service signup"],
    imagery: ["Completed gardens at golden hour", "Before/after pairs from the same angle", "Craft close-ups (paving, planting)", "Team at work in branded clothing"],
    icons: ["Leaf", "Ruler", "Sun", "Shovel", "Star"],
    trustSignals: ["Accreditation (e.g. BALI, APL)", "Insurance levels", "Award wins", "Named designers", "Project value ranges", "Guarantee on planting/workmanship"],
    keywords: ["landscapers {city}", "garden design {city}", "driveway paving {city}", "fencing {city}", "tree surgery {city}"],
    designStyle: "Editorial Natural Premium",
    microCopy: ["Free design consultation", "Fully insured", "5-year workmanship guarantee"],
  },
  {
    key: "cleaning",
    label: "Cleaning services",
    aliases: ["cleaning", "cleaner", "commercial cleaning", "domestic cleaning", "window cleaning", "carpet cleaning"],
    customerIntent: "Buyer wants reliability, vetting, insurance and clear pricing — usually for a recurring service.",
    businessOutcome: "More recurring contract clients with predictable monthly revenue and lower churn.",
    primaryConversions: ["Quote request", "Contract enquiry", "One-off deep clean booking", "Call"],
    mustHaveSections: ["Hero with clear positioning", "Services by client type", "Pricing approach", "Our vetting & insurance", "Coverage areas", "Reviews", "FAQ", "Contact"],
    optionalSections: ["Sector pages (offices, education, healthcare)", "Environmental policy", "Careers/recruitment", "Move-in/move-out checklist"],
    primaryCta: "Get a Cleaning Quote",
    secondaryCta: "Book a One-Off Clean",
    mustHaveFeatures: ["Quote form with property type/size", "Coverage area checker", "DBS/vetting statement", "Insurance documentation", "Recurring plan options", "Online booking for one-off cleans"],
    optionalFeatures: ["Client portal for schedules", "Site-specific risk assessments", "Automated invoicing", "Staff app integration information"],
    imagery: ["Uniformed staff in professional settings", "Spotless commercial interiors", "Cleaning equipment in use", "Team/vehicle imagery"],
    icons: ["Sparkle", "Shield", "Clock", "Checklist", "Building"],
    trustSignals: ["DBS-checked staff statement", "Public liability insurance level", "Membership (e.g. BICSc, CHSA)", "Client logos", "Retention rate", "Environmental certifications"],
    keywords: ["commercial cleaning {city}", "office cleaners {city}", "cleaners near me", "carpet cleaning {city}"],
    designStyle: "Clean Modern Trustworthy",
    microCopy: ["DBS-checked and fully insured", "Flexible contracts, no lock-in", "Free site survey"],
  },
  {
    key: "fitness",
    label: "Fitness & wellness",
    aliases: ["fitness", "gym", "personal train", "studio", "yoga", "pilates", "wellness", "sports"],
    customerIntent: "Prospect is self-conscious and unsure — wants to see the environment, understand the entry offer and try before committing.",
    businessOutcome: "More trial sign-ups converting to memberships, and higher-value personal training packages.",
    primaryConversions: ["Free trial signup", "Membership enquiry", "Class booking", "Personal training enquiry"],
    mustHaveSections: ["Hero with facilities", "Class timetable", "Membership pricing", "Meet the coaches", "Results & transformations", "First-timer guide", "FAQ", "Location"],
    optionalSections: ["Facility virtual tour", "Nutrition services", "Challenge programmes", "Corporate wellness", "Merch"],
    primaryCta: "Claim Your Free Trial",
    secondaryCta: "See Class Timetable",
    mustHaveFeatures: ["Live class timetable", "Membership comparison table", "Trial booking form", "Coach bios", "Google Maps", "Review integration"],
    optionalFeatures: ["Member portal login", "Class booking and waitlists", "Payment/joining integration", "Transformation gallery"],
    imagery: ["Real members training (consented)", "Coach on the floor", "Classes in progress", "Facilities detail shots"],
    icons: ["Dumbbell", "Calendar", "Heart", "Users", "Star"],
    trustSignals: ["Coach qualifications", "Insurance", "Member count", "Review rating", "Industry body membership"],
    keywords: ["gym in {city}", "personal trainer {city}", "yoga studio {city}", "pilates classes {city}"],
    designStyle: "Energetic Modern Bold",
    microCopy: ["No joining fee this month", "First class free", "Cancel anytime"],
  },
  {
    key: "beauty",
    label: "Beauty & personal care",
    aliases: ["beauty", "salon", "hair", "barber", "spa", "nail", "aesthetic", "cosmetic"],
    customerIntent: "Client wants to see styles, prices and availability, and to book instantly from a phone.",
    businessOutcome: "More direct bookings at full price rather than discount-platform bookings that erode margin.",
    primaryConversions: ["Online booking", "Price list view", "Gift voucher purchase", "Consultation enquiry"],
    mustHaveSections: ["Hero with styling imagery", "Treatments & price list", "Booking widget", "Team stylists", "Gallery", "Reviews", "Opening hours", "Contact"],
    optionalSections: ["Offers & seasonal packages", "Loyalty scheme", "Gift vouchers", "Courses & training", "Instagram feed"],
    primaryCta: "Book Online Now",
    secondaryCta: "View Treatments & Prices",
    mustHaveFeatures: ["Booking integration", "Price list with treatment durations", "Team profiles", "Instagram gallery embed", "Gift voucher purchase", "Cancellation policy"],
    optionalFeatures: ["Loyalty programme", "Membership packages", "Patch test booking", "Aftercare guides"],
    imagery: ["Consistent, high-quality before/after work", "Interior atmosphere", "Stylist portraits", "Product flat-lays"],
    icons: ["Scissors", "Sparkle", "Calendar", "Heart", "Gift"],
    trustSignals: ["Stylist qualifications and certifications", "Review count", "Award nominations", "Insurance", "Years established"],
    keywords: ["hair salon {city}", "barber {city}", "nails {city}", "spa treatments {city}", "aesthetics clinic {city}"],
    designStyle: "Elegant Editorial Warm",
    microCopy: ["Book online in 30 seconds", "Free consultation with every colour service", "Gift vouchers available"],
  },
  {
    key: "ecommerce",
    label: "Retail & e-commerce",
    aliases: ["retail", "shop", "store", "ecommerce", "e-commerce", "wholesale", "products"],
    customerIntent: "Shopper wants to find the right product fast, trust the seller, and check out without friction.",
    businessOutcome: "Higher conversion rate and average order value from existing traffic, plus repeat purchase revenue.",
    primaryConversions: ["Add to cart", "Purchase", "Product enquiry", "Newsletter signup"],
    mustHaveSections: ["Hero with a commercial offer", "Featured collections", "Best sellers", "Why buy from us", "Reviews", "Shipping & returns", "About", "Contact"],
    optionalSections: ["Buying guides", "Size/fit finders", "Bundles & offers", "Trade/wholesale enquiry", "Sustainability story"],
    primaryCta: "Shop the Collection",
    secondaryCta: "Browse Best Sellers",
    mustHaveFeatures: ["Fast product search and filters", "Clear delivery and returns policy", "Trust badges and secure payment marks", "Product reviews", "Abandoned basket email", "Mobile-optimised checkout"],
    optionalFeatures: ["Trade accounts", "Subscription products", "Click and collect", "Live inventory display", "Wishlists"],
    imagery: ["Consistent studio product photography", "Product in context/lifestyle", "Packaging and unboxing", "Team or workshop story"],
    icons: ["Shopping bag", "Truck", "Lock (secure)", "Star", "Refresh (returns)"],
    trustSignals: ["Verified reviews", "Secure payment badges", "Clear returns policy", "Company registration details", "Physical address/phone", "Delivery guarantees"],
    keywords: ["buy {product} online", "{product} shop", "wholesale {product}", "{category} uk"],
    designStyle: "Clean Commercial Conversion-led",
    microCopy: ["Free UK delivery over £50", "30-day returns", "Secure checkout"],
  },
  {
    key: "professional_services",
    label: "Professional & B2B services",
    aliases: ["consulting", "consultancy", "marketing agency", "it services", "software", "recruitment", "architecture", "engineering", "surveyor", "insurance", "financial"],
    customerIntent: "Buyer is researching providers, wants to understand specialism, process and proof before a discovery call.",
    businessOutcome: "Higher-quality inbound enquiries and shorter sales cycles, because the site pre-qualifies on fit and budget.",
    primaryConversions: ["Discovery call booking", "Proposal request", "Case study download", "Newsletter signup"],
    mustHaveSections: ["Hero with a clear value proposition", "Services by outcome", "Proof (case studies with metrics)", "Process", "Who we work with", "Team", "Insights", "Contact"],
    optionalSections: ["Pricing guidance", "Interactive assessment/audit tool", "Webinars", "Partners", "Careers"],
    primaryCta: "Book a Discovery Call",
    secondaryCta: "See Our Case Studies",
    mustHaveFeatures: ["Case studies with measurable outcomes", "Consultation scheduling", "Lead qualification form", "Resource downloads gated for leads", "Team credibility", "Client logos"],
    optionalFeatures: ["Interactive ROI calculator", "Client portal", "Webinar registration", "Account-based landing pages"],
    imagery: ["Team at work (authentic)", "Client environments", "Abstract data/process visuals", "Office culture"],
    icons: ["Target", "Chart", "Puzzle", "Users", "Lightbulb"],
    trustSignals: ["Client logos and named results", "Certifications and accreditations", "Named senior team", "Industry memberships", "Case study metrics"],
    keywords: ["{service} agency {city}", "{service} consultants uk", "b2b {service} provider"],
    designStyle: "Confident Modern Professional",
    microCopy: ["No-obligation discovery call", "Fixed-scope engagements", "Senior team on every project"],
  },
];

const DEFAULT_PROFILE: IndustryProfile = {
  key: "local_services",
  label: "Local services",
  aliases: [],
  customerIntent: "Local buyer is comparing providers and needs reassurance on credibility, coverage and how to make contact.",
  businessOutcome: "More qualified local enquiries captured around the clock.",
  primaryConversions: ["Enquiry form", "Phone call", "Quote request"],
  mustHaveSections: ["Hero with clear positioning", "Services", "Why choose us", "Proof & testimonials", "Process", "FAQ", "Contact"],
  optionalSections: ["Gallery", "Coverage areas", "Team", "Pricing guidance"],
  primaryCta: "Get a Free Quote",
  secondaryCta: "Call Us Today",
  mustHaveFeatures: ["Quote request form", "Click-to-call", "Google Maps", "Reviews", "Mobile optimisation", "Analytics + conversion tracking", "Local SEO foundation"],
  optionalFeatures: ["Online booking", "WhatsApp enquiries", "Live chat", "Newsletter"],
  imagery: ["Real work in progress", "Team at work", "Completed results", "Local area context"],
  icons: ["Check", "Star", "Map pin", "Phone", "Clock"],
  trustSignals: ["Named team members", "Insurance and accreditations", "Verified review count", "Years trading", "Guarantee statement"],
  keywords: ["{service} in {city}", "local {service}", "{service} near me"],
  designStyle: "Modern Premium Professional",
  microCopy: ["Free no-obligation quote", "Fully insured", "Local and trusted"],
};

export function industryProfile(industry?: string | null, category?: string | null): IndustryProfile {
  const haystack = `${industry ?? ""} ${category ?? ""}`.toLowerCase().trim();
  if (!haystack) return DEFAULT_PROFILE;
  let best: { profile: IndustryProfile; length: number } | null = null;
  PROFILES.forEach((profile) => {
    profile.aliases.forEach((alias) => {
      if (haystack.includes(alias) && (!best || alias.length > best.length)) {
        best = { profile, length: alias.length };
      }
    });
  });
  return best ? (best as { profile: IndustryProfile }).profile : DEFAULT_PROFILE;
}

export function allIndustryProfiles(): IndustryProfile[] {
  return PROFILES;
}

export function industryKeywords(profile: IndustryProfile, city?: string | null): string[] {
  const locality = city?.trim() || "your area";
  return profile.keywords.map((keyword) => keyword.replace(/\{city\}/g, locality));
}

export function defaultIndustry(): IndustryProfile {
  return DEFAULT_PROFILE;
}
