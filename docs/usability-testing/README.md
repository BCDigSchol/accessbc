# Testing Access BC with the people it's for

Automated checks (see [tests/accessibility/](../../tests/accessibility/)) catch missing labels, contrast problems,
and broken keyboard behaviour. They can't tell us whether a blind student can actually get from O'Neill to
McElroy with Access BC, whether "Bear right" means anything on a cane, or whether the sounds help or annoy. Only
testing with students and specialists can.

This folder has what's needed to run that testing:

| File | What it's for |
|---|---|
| [review-guide.md](review-guide.md) | An expert review of how directions are worded, by an orientation and mobility (O&M) instructor |
| [instruction-samples.md](instruction-samples.md) | Real directions for the review (generated; see below) |
| [session-guide.md](session-guide.md) | A script for one-to-one sessions with students, including walking a route |
| [observation-sheet.csv](observation-sheet.csv) | One row per task per participant, for notes during sessions |

## Who to work with

- **BC's Disability Services Office**: to reach students who might take part (they shouldn't share names with
  us; they pass on the invitation), to advise on accommodations for the sessions, and to review this plan.
- **An orientation and mobility (O&M) instructor**: certified O&M specialists teach blind and low-vision people
  to travel independently. They're the best judges of instruction wording and of what's safe. The
  Massachusetts Commission for the Blind and Perkins School for the Blind both employ or can recommend O&M
  specialists; Disability Services may already work with one.
- **Students**, aiming for 5 to 8 across:
  - blind students who use a screen reader (VoiceOver and TalkBack users both) and a cane or guide dog;
  - low-vision students who use zoom, large text, or high contrast;
  - at least one wheelchair user, since routes are built for step-free access too;
  - at least one Deaf or hard-of-hearing student, for everything that's announced by sound.

  Five participants in a group usually find most of the problems that group has; more groups matter more than
  more people per group.

## Order of work

1. **O&M review of the wording** ([review-guide.md](review-guide.md)), before testing with students, so obvious
   problems are fixed first. About an hour of the instructor's time, done remotely.
2. **Fix what the review finds**, then regenerate [instruction-samples.md](instruction-samples.md):
   `node scripts/routing/sample-instructions.mjs`.
3. **Sessions with students** ([session-guide.md](session-guide.md)): about an hour each, one to one, partly
   indoors at a computer or phone and partly walking a short route outdoors.
4. **Fix, then test again** with two or three new participants.

## Before the sessions

- **Ethics review.** If results may be published or presented as research, check with BC's Institutional Review
  Board first. Testing only to improve the app usually doesn't need review, but the IRB decides that, not us.
- **Consent.** Use a short consent form, offered in an accessible format (an accessible PDF or Word file,
  large print, or read aloud), covering what we'll do, what we'll record, that they can stop at any time, and
  that taking part has no effect on their services or studies.
- **Pay participants** for their time (a gift card is typical), and say so in the invitation.
- **Safety on the walk.** A sighted facilitator walks beside the participant throughout, ready to step in.
  Choose a route without construction, check it the day before, and avoid busy times. The participant's own
  mobility skills come first: they should never follow the app into something that feels unsafe.
- **Accommodations.** Meet at an accessible location the participant knows how to reach (or meet them where
  they are); allow for guide dog breaks; offer materials in the participant's preferred format; for Deaf
  participants, arrange an interpreter or work in writing as they prefer.
- **Devices.** Participants use their own phone, with their own screen reader settings and voice, wherever
  possible: that's how they'll really use it. Have a charged iPhone and Android phone as backups.
- **Recording** (with permission only): audio, and notes on the observation sheet. Screen recording on the
  participant's own phone only if they're comfortable with it.

## After each session

- Fill in the observation sheet the same day, while it's fresh.
- Log each problem found as a GitHub issue with the label `usability`, with how serious it is:
  - **critical**: couldn't complete the task, or it was unsafe;
  - **serious**: completed with difficulty, or only with help;
  - **minor**: an annoyance or confusion that didn't stop them.
- Never put names or other identifying details in issues or in this repository.

## What we most want to learn

- Can blind students start, follow, and finish a route with only the phone and their usual mobility skills?
- Are the instructions worded the way they'd want: clock positions or compass points, feet or steps, how
  often to hear updates, what landmarks are worth mentioning?
- Do Where am I?, Face the right way, the sounds, and the vibration help in practice, or get in the way?
- How do screen readers and Access BC's own speech get along (with and without "I use a screen reader")?
- How well does location following work around real buildings, and what do students do when it's wrong?
- What's missing that would make them trust it enough to use it on their own?
