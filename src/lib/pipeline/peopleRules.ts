// Deterministic parts of the management-change card: role classes, red flags,
// subtype for scoring, and a one-line title.
import type { PeopleExtractT } from "../llm/schemas";

type Change = PeopleExtractT["changes"][number];

const TOP_ROLE = /\b(managing director|md\b|ceo|chief executive|chief financial|cfo|chairman|chairperson|whole[- ]?time director|executive director|joint managing|deputy managing)/i;
const KMP = /\b(company secretary|compliance officer|chief operating|coo\b|cto\b|chief technology|chief risk|cro\b|chief business|president|head\b|senior management|key managerial)/i;
const INDEPENDENT = /\bindependent\b|non[- ]executive/i;
const AUDITOR = /\bauditor/i;

export function roleClassOf(designation: string, fallback: Change["role_class"]): Change["role_class"] {
  if (AUDITOR.test(designation)) return "auditor";
  if (INDEPENDENT.test(designation)) return "independent";
  if (TOP_ROLE.test(designation)) return "top";
  if (KMP.test(designation)) return "kmp";
  return fallback;
}

// Exits that are part of a plan: retirement, end of term, promotion, or handing back an
// additional charge when a full-time appointee takes over (common at public-sector boards).
const PLANNED_EXIT = /retire|superannuat|end of (his|her|the) term|completion of (his|her|the) term|tenure (end|complet)|not seeking re-?appointment|attain(ed|ing) the age|promot(ed|ion) within|elevat|additional charge|consequent (up)?on (the )?appointment|on (the )?appointment of|hand(ed|ing)? ?over|relinquish/i;

const nameKey = (n: string) => n.toLowerCase().replace(/\b(mr|ms|mrs|dr|shri|smt|prof)\.?\s+/g, "").replace(/[^a-z]+/g, " ").trim();

/** A seat on a subsidiary's board ("appointed on the Board of KPIT US, a material unlisted subsidiary"). */
const SUBSIDIARY_SEAT = /\b(?:board|director)s?\s+of\s+([A-Z][\w&.()\- ]{1,60}?),?\s+(?:(?:a|an|the|its|our)\s+)?(?:(?:wholly[- ]owned|material|unlisted|step[- ]down|indian|overseas|foreign)\s+)*subsidiar/i;
export function subsidiarySeat(c: Pick<Change, "quote" | "reason" | "designation">): string | null {
  const text = `${c.quote ?? ""} ${c.reason ?? ""} ${c.designation ?? ""}`;
  const m = text.match(SUBSIDIARY_SEAT);
  if (m) return m[1].trim();
  return /\bsubsidiary\b/i.test(c.designation ?? "") ? "a subsidiary" : null;
}

/**
 * An exit is part of a plan when the same filing names a successor to the role, or the person
 * stays on the board in another role ("steps down as MD & CEO ... appointed Non-Executive Director").
 */
function succeeded(c: Change, all: Change[]): boolean {
  const role = shortRole(c.designation);
  const me = nameKey(c.person_name);
  const incoming = (o: Change) => o.change_type === "appointment" || o.change_type === "redesignation" || o.change_type === "reappointment";
  return all.some((o) => o !== c && incoming(o) && (
    (nameKey(o.person_name) !== me && shortRole(o.designation) === role)   // a successor to the role
    || nameKey(o.person_name) === me));                                    // stays on in another role
}

export function isUnplannedExit(c: Change, all: Change[] = []): boolean {
  const rc = roleClassOf(c.designation, c.role_class);
  const exit = c.change_type === "resignation" || c.change_type === "cessation";
  if (!exit || !(rc === "top" || rc === "auditor") || subsidiarySeat(c)) return false;
  return !PLANNED_EXIT.test(`${c.reason ?? ""}`) && !(rc === "top" && succeeded(c, all));
}

export function flagsFor(c: Change, all: Change[] = []): string[] {
  const flags: string[] = [];
  const rc = roleClassOf(c.designation, c.role_class);
  const exit = c.change_type === "resignation" || c.change_type === "cessation";
  if (isUnplannedExit(c, all)) flags.push(`Unplanned ${shortRole(c.designation)} exit`);
  if (exit && rc === "independent" && c.reason && !/personal|pre-?occupation|other commitments|retire|term/i.test(c.reason)) {
    flags.push("Independent director exit with stated reasons");
  }
  return flags;
}

export function shortRole(designation: string): string {
  const d = designation.toLowerCase();
  if (/chief financial|\bcfo\b/.test(d)) return "CFO";
  if (/managing director.*(ceo|chief executive)|md\s*&\s*ceo|md and ceo/.test(d)) return "MD & CEO";
  if (/chief executive|\bceo\b/.test(d)) return "CEO";
  if (/managing director|\bmd\b/.test(d)) return "MD";
  if (/chairman|chairperson/.test(d)) return "Chairman";
  if (/auditor/.test(d)) return "auditor";
  if (/company secretary/.test(d)) return "company secretary";
  if (/independent/.test(d)) return "independent director";
  if (/whole[- ]?time director|executive director/.test(d)) return "whole-time director";
  if (/director/.test(d)) return designation.replace(/\s+/g, " ").trim();
  return designation.replace(/\s+/g, " ").trim();
}

/** The most important change in a filing decides the event's subtype and title. */
export function primaryChange(changes: Change[]): Change | null {
  // Within a role class: an unplanned exit leads, then an appointment, then a planned exit.
  const rank = (c: Change) => {
    const rc = subsidiarySeat(c) ? "other" : roleClassOf(c.designation, c.role_class);
    const r = { auditor: 5, top: 4, kmp: 2, independent: 1, other: 0 }[rc];
    return r * 10 + (isUnplannedExit(c, changes) ? 3 : c.change_type === "appointment" ? 2 : 1);
  };
  return [...changes].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

export function peopleSubtype(c: Change): string {
  if (subsidiarySeat(c)) return "other";
  const rc = roleClassOf(c.designation, c.role_class);
  if (rc === "auditor" && (c.change_type === "resignation" || c.change_type === "cessation")) return "auditor_exit";
  if (rc === "auditor") return "other";
  return rc;
}

const VERB: Record<Change["change_type"], string> = {
  appointment: "appointed", resignation: "resigns as", retirement: "retires as", cessation: "ceases to be",
  redesignation: "re-designated as", reappointment: "re-appointed as",
};

export function peopleTitle(c: Change): string {
  const sub = subsidiarySeat(c);
  if (sub) {
    const where = sub === "a subsidiary" ? "a subsidiary's board" : `the board of ${sub}, a subsidiary`;
    return c.change_type === "appointment" || c.change_type === "reappointment" ? `${c.person_name} joins ${where}` : `${c.person_name} leaves ${where}`;
  }
  const role = shortRole(c.designation);
  const verb = VERB[c.change_type];
  return c.change_type === "appointment" ? `${c.person_name} appointed ${role}` : `${c.person_name} ${verb} ${role}`;
}
