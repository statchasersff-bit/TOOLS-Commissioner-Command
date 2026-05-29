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

export const CURRENT_UPDATE_VERSION = "2026-05-29-dynasty-command-v1.8";

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
  title: "Commander's Briefing — Automation Features Opening Again Soon 📊",
  date: "May 29, 2026",
  sections: [
    {
      heading: "Note",
      items: [
        "Waiver Command, Lineup Command, and Trade Features access will be re-enabled with a target date of June 15 for all to use. Set lineups, send/accept trades, and make waiver claims directly from Dynasty Command.",
      ],
    },
    {
      heading: "New Features",
      items: [
        "Trade Idea Generator added to the Trade Center Module",
        "Biggest ADP Movers in past 7 days added to the ADP Explorer tab",
        "KeepTradeCut (KTC) values added as a Value Source Option",
        "In Personalization Settings: option added to add filtered leagues to your portfolio",
        "Recent news log added to main page",
        "Discord feature added to share your trades directly from the tool to StatChasers Discord for people to vote on",
        "Sleeper user profile pages beta launch — click on any of your leaguemates and see their profile info",
      ],
    },
    {
      heading: "Improvements",
      items: [
        "Light mode more enhanced",
        "Arizona Cardinals Team Mode added",
      ],
    },
    {
      heading: "Note from Developer",
      items: [
        "Thank you for everyone's patience and support as we build out this tool. The support has been amazing and I appreciate the ones who have been sharing the tool to others. We are getting to a point where I need to figure out ways to make the tool not crash as much due to the high traffic I wasn't ready for this early. Cheers y'all and I hope you enjoy the current new features. Many more to come!",
      ],
    },
  ],
};

// Past releases shown in the in-app changelog. Newest first. Append the
// previous CURRENT_UPDATE_NOTES here when bumping CURRENT_UPDATE_VERSION.
export const CHANGELOG_HISTORY: UpdateNotes[] = [
  {
    version: "2026-05-26-dynasty-command-v1.7",
    title: "Commander's Briefing — Player Intel Upgrade 📊",
    subtitle: "The player analysis suite just got a serious overhaul. Here's what's new.",
    date: "May 26, 2026",
    sections: [
      {
        heading: "New Features",
        items: [
          "Advanced Stats added to the Research Module",
          "Player Profile pages added",
          "ADP Filters added to player profile pages to allow filter controls for QB format, scoring, TE premium, and team count",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Light mode more enhanced",
          "Mobile views for Team comparison feature",
        ],
      },
    ],
  },
  {
    version: "2026-05-19-dynasty-command-v1.6",
    title: "Welcome Back, Commander! 🫡",
    subtitle: "Fresh upgrades are live. Here's what changed since your last huddle.",
    date: "May 19, 2026",
    sections: [
      {
        heading: "New Features",
        items: [
          "League Analyzer - Playoff Calculator: See every team's projected odds to make the playoffs, earn a bye, reach the finals, and win the championship, plus a weekly matchups breakdown with win probabilities.",
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
  },
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
