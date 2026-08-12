# OctoLens Privacy Policy

**Effective date:** August 12, 2026
**Applies to:** OctoLens — Similar Repos for GitHub

OctoLens is a local-first browser extension maintained by
[DataSwarm Project](https://github.com/dataswarmproject). It helps people
discover, compare, save, and revisit public GitHub repositories while browsing
GitHub.

## The short version

- OctoLens has no developer-operated server, account system, analytics, ads, or
  tracking SDK.
- Your bookmarks, recently viewed GitHub repositories, notes, preferences,
  settings, API cache, and optional GitHub token are stored locally in your
  browser profile.
- OctoLens sends repository identifiers and search queries directly to the
  GitHub API to provide its features. If you add a GitHub token, it is sent only
  to `https://api.github.com` as an authorization credential.
- OctoLens does not sell user data or use it for advertising, creditworthiness,
  lending, or unrelated purposes.

## Data OctoLens handles

### GitHub browsing context

When you open a public GitHub repository page, OctoLens reads the repository
owner and name from the page URL. It uses that identifier to fetch repository
metadata and recommendations and records it in the local **Recent** list. You
can clear this list at any time from the popup.

OctoLens also reads GitHub repository links that are already visible on a page
when you request or trigger a repository hovercard. It does not read page form
entries, passwords, cookies, private messages, or unrelated browsing activity.

### User-provided and preference data

OctoLens stores the following in `chrome.storage.local`:

- Bookmarked repository identifiers and public metadata
- Private notes that you write about repositories
- Recently viewed repository identifiers and public metadata
- Likes, hides, clicks, topic/language/author preferences, and feature settings
- Cached public GitHub API responses
- An optional GitHub personal access token, if you choose to provide one

Backups created with **Export data** include bookmarks, history, notes,
preferences, and feature settings. Backups never include the GitHub token or API
cache. Exported files are saved only where you choose on your device.

### Data sent to GitHub

OctoLens sends the current public repository identifier and user-entered public
repository search queries directly to `https://api.github.com`. GitHub returns
public repository metadata used for recommendations, search results, statistics,
and hovercards.

If you provide an optional GitHub token, OctoLens sends it only to GitHub in the
HTTPS `Authorization` header. The token is used to authenticate direct GitHub API
requests and increase the applicable API rate limit. OctoLens does not send the
token to DataSwarm Project or any other service.

GitHub processes these requests under its own
[Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Sharing and sale

OctoLens does not sell, rent, trade, or share user data with DataSwarm Project,
advertisers, data brokers, or other third parties. Data is transferred only to
GitHub as necessary to provide the extension's single purpose and user-requested
features, or when you deliberately open an external repository or editor link.

## Retention and deletion

Local data remains in the browser profile until you clear it, remove it through
OctoLens controls, clear the extension's storage, or uninstall the extension.
API cache entries expire after 12 hours and may also be cleared manually.

You can:

- Clear recently viewed repositories from the **Recent** tab
- Delete individual bookmarks and notes
- Reset personalization and unhide repositories in **Settings**
- Clear cached GitHub API responses in **Settings**
- Remove the optional GitHub token by clearing the token field and saving
- Remove all extension data by uninstalling OctoLens or clearing its site data

## Security

Network requests use HTTPS. OctoLens requests only the Chrome `storage`
permission, access to `https://api.github.com/*`, and a content script on
`https://github.com/*` for its visible GitHub integration. The published package
contains no remotely hosted executable code.

The optional token is stored by Chrome in the local extension storage area. It
is not included in exports. Device and browser-profile security still matter;
use a fine-grained token with the least privilege required for public repository
access and revoke it in GitHub if you believe it has been exposed.

## Children

OctoLens is a developer utility and is not directed to children under 13. It
does not knowingly collect children's personal information.

## Changes to this policy

Material changes to OctoLens data practices will be disclosed in the extension
interface and store listing before the changed handling begins. This document's
effective date will also be updated.

## Contact

For privacy questions or requests, open an issue in the
[OctoLens issue tracker](https://github.com/dataswarmproject/octolens/issues).
