// ── Dynasty Command release notes ────────────────────────────────────────────
//
// The "What's New" modal in DCC reads from this file. It compares the user's
// last-acknowledged version (localStorage `dc_seen_update_version`) against
// CURRENT_UPDATE_VERSION; if they differ, the modal opens once. Dismissal
// writes the current version back to localStorage.
//
// Release workflow (MANUAL — do not bump on every code change):
//   1. Edit CURRENT_UPDATE_NOTES with the highlights for this release.
//   2. Get Mak's explicit approval of the notes.
//   3. Only after approval, bump CURRENT_UPDATE_VERSION below.
//   4. Move the previous entry into CHANGELOG_HISTORY so the in-app changelog
//      keeps a record.
//   5. Publish.
//
// Version key shape: "YYYY-MM-DD-<slug>-vX.Y". Any change to the string
// triggers the modal for every user on their next dashboard load.

export const CURRENT_UPDATE_VERSION = "2026-05-19-dynasty-command-v1.6";

export interface UpdateSection {
  heading: string;
  items: string[];
}

export interface UpdateNotes {
  version: string;
  title: string;
  subtitle?: string;
  date: string;
  sections: UpdateSection[];
}

export const CURRENT_UPDATE_NOTES: UpdateNotes = {
  version: CURRENT_UPDATE_VERSION,
  title: "Welcome Back, Commander! 🫡",
  subtitle: "Fresh upgrades are live. Here's what changed since your last huddle.",
  date: "May 19, 2026",
  sections: [
    {
      heading: "New Features",
      items: [
        "League Analyzer - Playoff Calculator: See every team's projected odds to make the playoffs, earn a bye, reach the finals, and win the championship — plus a weekly matchups breakdown with win probabilities.",
        "My Team - Overview: New analytical sections added, including roster construction breakdown, age curve, and dynasty window outlook.",
      ],
    },
    {
      heading: "Improvements",
      items: [
        "League Analyzer - Compare Teams: Rebuilt to support side-by-side comparison of up to 3 teams with cleaner layout and easier controls.",
        "Finance tab: Fixed a click-out bug that caused the tab to close unexpectedly.",
      ],
    },
  ],
};

// Past releases shown in the in-app changelog. Newest first. Append the
// previous CURRENT_UPDATE_NOTES here when bumping CURRENT_UPDATE_VERSION.
export const CHANGELOG_HISTORY: UpdateNotes[] = [
  {
    version: "2026-05-18-dynasty-command-v1.5",
    title: "What's New in Dynasty Command",
    subtitle: "Recent updates are now live.",
    date: "May 18, 2026",
    sections: [
      {
        heading: "New Features",
        items: [
          "Research - Market Value: now includes 2026 rookies and future draft picks under the \"All Pos\" filter.",
          "Player/Pick Values: Updated option to enter custom values.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Command Center - My Portfolio: Mobile improvements to League Breakdown tab and Finance tab.",
        ],
      },
    ],
  },
  {
    version: "2026-05-17-dynasty-command-v1.4",
    title: "What's New in Dynasty Command",
    subtitle: "Recent updates are now live.",
    date: "May 17, 2026",
    sections: [
      {
        heading: "New Features",
        items: [
          "Implemented plans for a global shared activeLeagueId system across Dynasty Command.",
          "Synced header league selector with league-specific module pages.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Redesigned Finance tables to reduce horizontal scrolling on mobile.",
          "Improved mobile scatter plot layout for Power Rankings.",
        ],
      },
    ],
  },
];

export const SEEN_UPDATE_STORAGE_KEY = "dc_seen_update_version";
