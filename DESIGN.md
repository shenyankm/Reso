---
name: Reso
description: Reso UI V2.1 mobile conversation interface
colors:
  ground: "#f9f9fc"
  paper: "#fff"
  ink: "#243c61"
  body: "#283545"
  muted: "#5d708c"
  blue: "#1674d5"
  blue-soft: "#d6e8ff"
  line: "#dfe6f2"
  purple: "#8f6bba"
  purple-soft: "#f3edfc"
  green: "#178568"
  pink-soft: "#f9e7f0"
  bubble: "#ededf0"
  button-cyan: "#c4effb"
  button-blue: "#d8e8ff"
  button-pink: "#f6dced"
typography:
  display:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.28
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    lineHeight: 1.8
  label:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "11px"
  story-title:
    fontFamily: "'Songti SC', 'Noto Serif SC', serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.6
rounded:
  field: "12px"
  chip: "20px"
  card: "20px"
  button: "24px"
  composer: "26px"
spacing:
  compact: "8px"
  small: "12px"
  gutter: "16px"
  card: "18px"
  roomy: "20px"
components:
  button-primary:
    textColor: "#1766b5"
    rounded: "{rounded.button}"
    padding: "11px 18px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "#526b8d"
    rounded: "{rounded.button}"
    padding: "11px 18px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "18px"
  bubble:
    backgroundColor: "{colors.bubble}"
    textColor: "#28303b"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  suggestion:
    backgroundColor: "{colors.paper}"
    textColor: "#52708f"
    rounded: "{rounded.chip}"
    padding: "8px 13px"
---

# Design System: Reso

## Overview

**Creative North Star: "Reso UI V2.1 — a quiet conversation"**

Reso UI V2.1 uses a quiet, light mobile conversation space. Pale blue and pink action gradients sit beside neutral chat bubbles and lavender story cards. The supplied Reso character and story illustrations carry the personality; the interface supports them with restrained chrome and rounded surfaces.

This documents the existing implementation, rather than proposing a new identity. `src/styles.css` owns the implemented values; `src/components.tsx` owns the Button, Bubble, Card, and HTML Dialog conventions; `src/MvpApp.tsx` owns the business flows.

**Key Characteristics:**
- Single-column mobile conversations and inline cards.
- Pale blue/pink gradient actions, neutral and lavender surfaces.
- Original Reso mascot and supplied story imagery.
- Clear dark text, visible focus, and reduced-motion support.

## Colors

### Primary

Blue marks navigation, links, focus, and action text. The primary button uses the source gradient: cyan through pale blue to pink (`--button-fill`); retain all three stops.

### Secondary

Purple and pale lavender identify story exercises and reflective notes. Pale pink differentiates the mother's messages and related relationship accents. Green supports private/confirmed status.

### Neutral

Ground is the off-white application canvas; paper is the card and control surface. Ink and body provide dark readable text, muted supports secondary copy, line separates surfaces, and bubble is the neutral assistant message background.

**The Source Continuity Rule.** Keep the original gradient, mascot, and story imagery together; they define the supplied visual world.

## Typography

The system uses the platform Chinese sans stack throughout, with Songti reserved for story titles and the music artwork title. Online app bars use a shared 22px semibold title, reduced to 20px in narrow windows. Card headings are 16–18px, message text is 14px, and supporting labels are 11–13px. The welcome display is the largest text; it reduces to 32px at the narrow breakpoint. Comfortable message line spacing lets Chinese copy breathe without making the compact controls oversized.

## Layout

Use one mobile column, full width up to 480px, and a 100dvh app frame. Header, composer, and bottom navigation remain outside the scrolling conversation. Online app bars, page content, the composer and bottom navigation share a 16px horizontal gutter, reduced to 12px at widths of 360px and below. The standard app bar is at least 80px high and uses a 64px minimum in short windows. Conversation gaps are 16px. In narrow windows, ordinary card padding is 14px. At 640px and above, retain a centered 430px preview, 20px vertical margins, 28px outer corners, and a maximum height of 980px. Respect safe-area insets at the header and bottom controls.

## Elevation & Depth

Depth is mostly tonal: off-white ground, white cards, pale tinted sections, and thin borders. The small floating shadow is reserved for composer/header controls. Desktop framing has a diffuse shadow; native dialogs use a stronger overlay shadow and dim backdrop. Ordinary chat cards remain flat.

## Shapes

Message bubbles use 20px corners. Online standard cards, including story and relationship surfaces, use 16px corners. Compact decision summaries and nested sharing panels use 12px corners. Buttons and chips are pill-like; the composer is a rounded 26px capsule. Nested fields and notes use smaller 12–14px corners. Icons remain simple outlined strokes, usually 20–24px; circular controls are at least 48px targets. Story and portrait images are clipped inside their existing card shapes rather than treated as page backgrounds.

## Components

### Buttons

The shared Button uses primary gradient or white outlined secondary variants, a minimum 48px height, semibold 14px primary text, and centered icon/text alignment. Relationship banners reuse the primary gradient. Their illustration and section background are separate from the button style. The welcome action is taller. Disabled actions use reduced opacity; press reduces opacity and hover subtly reduces brightness. Keyboard focus uses the shared blue outline.

### Cards / Containers

The shared online Card is white with a thin pale blue border, 16px corners, and 18px padding. Titles align a small outlined icon with the heading. Discovery cards replace the upper area with a pale blue/pink gradient; story cards use lavender, serif headings, and supplied landscape imagery.

### Messages and Suggestions

Assistant messages use neutral bubbles, user messages align right on pale blue, and mother messages use pale pink plus an explicit speaker label. Bubbles size to content and wrap long text. The quiet text action 这符合你的意思吗？ appears only after AI replies explicitly marked as an important summary or inference. Ordinary conversation and user messages carry no check action; proposal cards retain their own review controls without a duplicate prompt. Small white bordered suggestion pills wrap onto new lines.

### Inputs / Fields

The composer is a white capsule with an inset circular action; the input has transparent fill and 14px type. Focus changes the enclosing border. The relationship search uses a pale blue capsule. Correction textareas are white, bordered, and vertically resizable. Keep accessible labels even when the visual affordance is an icon.

### Navigation

The online app uses two equal icon and label destinations: Reso and 我的关系. Returning from 我的关系 resumes the last conversation. Shared events and person entries can open rooms. In chat, the composer and bottom bar sit below the scrolling conversation. The screen retains header and system Back navigation. Active navigation is blue with a pale circular icon halo; inactive labels are muted. Event and people tabs are rounded white controls with a pale blue selected fill. The standalone UI preview keeps its original navigation.

我的 groups account identity, saved records, and privacy/settings in the existing single-column layout. White grouped rows carry actions; headings sit on the page ground. Nickname edits stay inline with a labeled field, explicit save/cancel and retained input after failure. Saved records name their type, source event and update time, and open the original private record. Local drafts are explicitly distinguished from records saved to the account. Privacy/data offers per-event export through the existing platform export flow. Account shortcuts appear in chat. The person icon opens a small non-modal popover with 我的 and 安全与人工支持. Account details, service information, professional workspace and logout are available in 我的. The event-context ellipsis continues to own event actions.

我的记录 collects all saved stories, expression practices and followups. 待回访 shows only followups not yet reviewed; reviewing one removes it from this action list while keeping its original record. Practice entry labels describe the user's goal: 整理这件事, 写下我的表达, and 练习怎么开口. Keep the existing methods, fields and save/share boundaries behind these labels. Chat tools contain practice and communication actions; this event’s records stay in the event menu. The first empty conversation explains the composer’s tool button with noninteractive text instead of adding a second button.

### Dialogs and Feedback

Online disclosures use a trailing chevron, a minimum 48px target and a visible inset focus ring. The chevron rotates on expansion. Booking statuses share one badge in relationship lists, appointment details and the counselor workspace. Proposed time uses amber and confirmed appointments use green.

Use native modal dialogs with rounded light surfaces, close control, backdrop, and contained scrolling. Toasts use a compact dark rounded surface above the composer. State transitions are short; typing and toast entry motion are suppressed by the reduced-motion preference.

## Do's and Don'ts

### Do:
- Do reuse the supplied Reso mascot and story images.
- Do keep primary actions in the existing pale blue/pink gradient.
- Do place exercises, sharing choices, and confirmations inside the conversation.
- Do preserve visible keyboard focus, labeled icon buttons, and reduced-motion behavior.

### Don't:
- Don't introduce a new visual identity or replace the supplied imagery.
- Don't stretch the mobile composition into a desktop dashboard.
- Don't make small supporting text pale enough to lose contrast.

## Android and business forms

The Android container applies system-bar, cutout and IME insets once, zeroing handled insets before the WebView receives them. System Back closes the current sheet, returns through the current task, and leaves the app only at the root. The platform font scale applies to WebView text. Keep the original light visual identity; do not infer a new visual world from the Android wrapper.

Business fields use persistent labels above full-width inputs and multiline areas. Preserve the shared focus, border, padding and radius. Private writing exposes draft/saving/saved states; local drafts do not count as saved or shared records. Conflicting server revisions require explicit review.

The tools sheet progressively reveals three task groups. Account actions stay in the top menu; event actions name the event and appear only within its task. Shared-summary details identify recipient, exact text, version and time.

## Entry and recovery

The online welcome screen uses the original mascot, one privacy highlight, a grouped list of promises, and access to the terms, privacy policy and guardian information. The scrollable primary action opens login after consent. An empty private conversation offers one optional route to chat tools, which disappears after the first saved message. Empty understanding, growth, and application views connect to a real next action.

Event names in the context bar use a single-line preview; the complete name remains in the event menu and accessible action name. Event-read failures show retry and list recovery, and disable the composer until detail is available. Pending dialogs expose busy state, disable dismiss controls, and retain form contents until the request settles. Account expiry returns to login mode and clears the password.

## Soft response motion and visual roles

Blue identifies actions and understanding; existing purple identifies narrative and expression work; green with a check identifies a confirmed server save. Local drafts keep neutral text and never gain the saved check. Source, consent and confirmation explanations use left-aligned 13px supporting copy; card body text is 14px. Narrow screens retain readable supporting text and action labels.

The welcome mascot gives one 640ms greeting, with the CTA available immediately. Chapter position moves along a 220ms SVG line; numbered 48px controls permit direct navigation and do not imply that earlier chapters were completed. Successful private saves reveal a 260ms check. Dialogs enter with a brief lift while dismissal remains immediate. These effects use CSS/SVG and existing art, with no loops, sound or new dependencies. Reduced motion removes movement while preserving the complete static feedback.

The composer and bottom navigation stay outside the scrolling conversation. At 320px with 200% system text, the private visibility label stays together; the event context keeps its accessible full name. Professional refresh sits beside its section title and can wrap as a unit when needed.

## Copy and compact Android windows

Use “私人聊天” for the user's private conversation and “房间聊天” for messages visible to current room members. “分享摘要” refers to the explicitly confirmed fixed version; it does not include private chat, questionnaire answers or stories. User-facing copy names AI replies and voice-to-text rather than Agent context or ASR. Account loading states name login or account creation. A timeout means the result is not yet confirmed; it does not prove that a write failed. Show a dialog's error once, inside that dialog.

At heights below 560px, non-chat navigation uses one compact horizontal row and remains available outside editing. Input-focused task pages may reclaim that row while editing. Compact dialogs keep their header and close action available while content scrolls; below 200px, reduce outer padding and preview the title on one line while preserving its full accessible name. Keep all action targets at least 48px.

Live updates and fallback polling stop when the document is hidden. Returning to the foreground reconnects and reads current state, including updates missed in the background. Requests already saving user input finish normally. No new cache or optimistic write layer is introduced.

Chat tools keep a fixed 48px plus control beside the composer, independently of the send action and draft content. Opening a practice preserves the unsent message. Invitation management offers the existing summary editor in place and explains that a private story is separate from a shared summary; editing never selects sharing automatically. Before accepting an invitation, signed-in users see the inviter's account nickname, current member nicknames, and room-history visibility. Anonymous previews retain only basic invitation metadata. Use “房间聊天” consistently for the member conversation.

Long invitation cards keep their full content height and scroll with the containing page. Dialog headers stay visible while their content scrolls, including enlarged system text and keyboard-constrained windows.

Each assistant turn has a collapsed “Reso 决策摘要” disclosure immediately before its final bubble. The structured card uses a lavender surface, the compact 12px radius, a 48px summary target and 13px supporting text. Group state and response approach, evidence and methods, then route, Skill and completed tool calls. The expanded card scrolls with the conversation. Earlier replies use their recorded short summary or an explicit missing-summary state. Failed replies say no usable summary was produced.

While a reply runs, a quiet 13px status line names the actual backend phase: understanding, checking available information, composing, or reviewing. Transport failure says reconnecting rather than pretending the model is still thinking. Once validated and committed, only a newly observed reply reveals graphemes at about 33 per second. The complete text remains available to assistive technology; reduced motion, historical messages and urgent fixed safety guidance show the full text immediately. Backgrounding finishes the reveal, remounting does not replay it, and scrolling follows only while the reader stays near the bottom. No fabricated thinking delay or percentage is used.


### Important people overview

The 重要的人 tab follows the supplied relationship overview composition: mascot and title with two circular search/invite controls, a full-width tinted search field, icon tabs, three recent circular nickname avatars, a lavender/blue topic banner with the existing Reso character, grouped disclosure rows, and a separate private professional-support card. Use the same two-destination bottom navigation as the conversation.

Use actual account names, unique-person counts and shared-room titles. Group by each user’s private contact categories, with initials for avatars. Conversation history is available for ended rooms, with a visible status and no composer. Private support rows use the signed-in applicant's actual status, label test services, and return to the original application. The empty state keeps the same composition with truthful guidance. Search matches names and shared event titles. All controls retain 48px targets and long names wrap; the support header can wrap in compact windows.
