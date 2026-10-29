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

export function isUnplannedExit(c: Change): boolean {
  const rc = roleClassOf(c.designation, c.role_class);
  const exit = c.change_type === "resignation" || c.change_type === "cessation";
  return exit && (rc === "top" || rc === "auditor") && !PLANNED_EXIT.test(`${c.reason ?? ""}`);
}

export function flagsFor(c: Change): string[] {
  const flags: string[] = [];
  const rc = roleClassOf(c.designation, c.role_class);
  const exit = c.change_type === "resignation" || c.change_type === "cessation";
  if (isUnplannedExit(c)) flags.push(`Unplanned ${shortRole(c.designation)} exit`);
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
    const rc = roleClassOf(c.designation, c.role_class);
    const r = { auditor: 5, top: 4, kmp: 2, independent: 1, other: 0 }[rc];
    return r * 10 + (isUnplannedExit(c) ? 3 : c.change_type === "appointment" ? 2 : 1);
  };
  return [...changes].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

export function peopleSubtype(c: Change): string {
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
  const role = shortRole(c.designation);
  const verb = VERB[c.change_type];
  return c.change_type === "appointment" ? `${c.person_name} appointed ${role}` : `${c.person_name} ${verb} ${role}`;
}
