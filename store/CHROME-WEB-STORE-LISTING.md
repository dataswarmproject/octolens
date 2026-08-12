# OctoLens Chrome Web Store Listing

This file is the source of truth for the public listing and Privacy practices
forms for OctoLens 1.2.2.

## Product details

**Name:** OctoLens — Similar Repos for GitHub

**Summary:** Discover similar GitHub repositories, preview project signals, and
keep a private local library without leaving GitHub.

**Category:** Developer Tools

**Language:** English

**Single purpose:** Help people discover, compare, save, and revisit public
GitHub repositories while browsing GitHub.

## Detailed description

See beyond the repository.

OctoLens adds a focused discovery layer directly to GitHub. Open a public
repository and immediately explore relevant alternatives, compare useful
project signals, preview repository links, and save what matters—all without an
OctoLens account or tracking backend.

DISCOVER RELEVANT ALTERNATIVES

• Find related public repositories using topics, language, and repository context.
• Understand why a recommendation appears through shared-topic signals.
• Shape results with likes, hides, clicks, bookmarks, and “More of…” choices.

EVALUATE WITHOUT TAB OVERLOAD

• Preview repository descriptions, stars, language, license, and recent activity.
• See age, last push, size, open issues and pull requests, and archive status.
• Copy HTTPS, SSH, or GitHub CLI clone commands.
• Open projects in github.dev, vscode.dev, StackBlitz, or CodeSandbox.

KEEP A PRIVATE LOCAL WORKSPACE

• Bookmark repositories and attach private notes.
• Revisit your local recent-repository history.
• Export or import your local library without including your GitHub token or API cache.
• Enable or disable major features from Settings.

LOCAL-FIRST BY DESIGN

OctoLens stores bookmarks, recent repositories, notes, preferences, settings,
cache data, and an optional GitHub token in your local Chrome profile. It sends
repository context and search queries directly to GitHub's API to provide its
features. The optional token is sent only to api.github.com. OctoLens has no
developer-operated backend, analytics, ads, or sale of user data.

Public GitHub API access works without a token. An optional fine-grained token
can provide a larger API allowance. Use the least privilege required for public
repository access.

OctoLens is open source under AGPL-3.0.

## URLs

**Homepage:** https://github.com/dataswarmproject/octolens

**Support:** https://github.com/dataswarmproject/octolens/issues

**Privacy policy:** https://github.com/dataswarmproject/octolens/blob/main/PRIVACY.md

## Privacy practices answers

### Permission justifications

**storage**
Stores feature settings, bookmarks, recent public repository identifiers,
private notes, personalization preferences, temporary GitHub API cache data, and
an optional GitHub token in the user's local Chrome profile. This data supports
the extension's visible features and is not sent to DataSwarm Project.

**Host access: https://api.github.com/***
Fetches public repository metadata, search results, rate-limit status, and
recommendation candidates directly from GitHub. If the user supplies an
optional token, it is sent only to this HTTPS API.

**Content script: https://github.com/***
Reads the current public repository identifier and visible repository links so
OctoLens can insert its discovery strip, show repository hovercards, and record
the user-facing local Recent list. It does not read cookies, passwords, private
messages, or form entries.

**Remote code**
No. All executable JavaScript and CSS is included in the uploaded package.

### User data categories handled

- **Authentication information:** optional GitHub personal access token; stored
  locally and sent only to GitHub's HTTPS API for authentication.
- **Web browsing activity:** public GitHub repository identifiers visited on
  GitHub; stored locally for the visible Recent feature and sent to GitHub's API
  to provide repository intelligence and recommendations.
- **User-generated content:** private repository notes and bookmarks; stored
  locally and never sent to DataSwarm Project.
- **Website content and resources:** public repository identifiers and public
  metadata needed for visible recommendations, statistics, and hovercards.

### Limited-use certification

The extension's data handling is limited to its single purpose and visible
user-facing features. User data is not sold, transferred for advertising or
creditworthiness, used for personalized advertising, or made available for
unrelated human review. Data is transferred only to GitHub as necessary to
provide the extension's purpose or when the user deliberately opens an external
link.

## Distribution

- Visibility: Public
- Regions: All regions supported by the Chrome Web Store
- Pricing: Free
- Contains ads: No
- In-app purchases: No

## Reviewer test instructions

1. Install OctoLens and open `https://github.com/pmndrs/zustand`.
2. Wait for the OctoLens strip below the repository navigation.
3. Confirm similar repository cards load and the like, hide, bookmark, note,
   clone, and editor controls are visible.
4. Hover a repository link elsewhere on GitHub to see an OctoLens hovercard.
5. Open the toolbar popup to test search, Saved, Recent, Notes, and Settings.
6. The optional GitHub token is not required for review.
