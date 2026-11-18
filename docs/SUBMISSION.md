# Cusity: TapeOut Accelerate submission answers

Official form: https://forms.gle/EoDNbxQ65dev1wFd9, which redirects to
`docs.google.com/forms/d/e/1FAIpQLScyVnDmyzxRyBxszLUWbwV5kVbpmZJ3JS6oyOxqjALRvhR1kg`. The form needs a Google sign-in.

These answers follow what the hackathon page asks for. Every `[[…]]` is a value that only exists after
the build, the tape-out and the campaign. Don't submit until none are left.

## Project name
Cusity

## One-line summary
A bot filter for airdrops and campaigns, built as a learned logic-gate circuit taped out on X Layer. Anyone can check a wallet for free, see why, audit the model's accuracy on chain, and appeal.

## Project description

**Product.** Cusity runs AI models made only of logic gates as TapeOut circuits on X Layer. The first model is a bot filter for airdrops and campaigns. It is trained with difflogic, compiled to [[N]] NAND gates, and taped out as a single circuit. The circuit has no weights file and no server. Anyone can check a wallet for free with `eth_call`, see which inputs decided the result, check the model's accuracy on chain against a test set committed in advance, and appeal through TapeSend.

**Target users.** Projects and creators who run campaigns, quests and airdrops on X Layer, and the users those campaigns filter.

**How we reach them.** We start with our own giveaway, run on Cusity, with [[N entrants]] entrants. We then offer the filter to X Layer projects running quests, and publish each campaign's commit and bind transactions as public proof.

**Revenue model.** Projects pay to commission a filter for a campaign and to have it committed on chain before the snapshot. Checks through `eth_call` stay free for users.

**Why users pay and keep using it.** Every campaign needs a bot filter, and every opaque filter causes public disputes. A filter that is committed in advance, checkable by every user, and audited on chain removes most of those disputes. Each new campaign means a new commission.

**What's new.** Cusity takes a trained ML model and turns it into a TapeOut circuit. It adds a gate-level explanation of each verdict in the browser, accuracy scored on chain from randomly sampled test rows, and a netlist hash committed before the campaign snapshot, so the filter can't be changed after the fact.

## Processor contract address
[[0x… processor]]

## Circuit ID
[[circuit id]]

## Access link (live site)
[[DeWEB link]]

## TapeOut ecosystem projects and features used
- Processor, NAND transistors, tape-out, `eval`, `netlist`, `circuitInfo`
- Circuit Container: hosts the site and receives appeals
- DeWEB (Website Repository) and TapeKit: the site, with no backend
- TapeSend: encrypted appeals to the model's Container
- TapeSynth: Verilog to verified NAND netlist, plus tape-out
- Contracts on X Layer: CusityRegistry [[0x…]], CampaignCommit [[0x…]], AccuracyAudit [[0x…]]

## Proof (campaign results)
Commit transaction [[link]] before snapshot block [[#]]. Bind transaction [[link]]. Audit score [[x/16]] on chain. [[N]] wallets checked, [[M]] appeals handled, [[0]] results overturned.

## Demo video (3 minutes or less)
[[video link]]

## Code repository
https://github.com/linoxbt/cusity (make sure it's public before submitting)

## Contact and team details
Fill these in yourself on the form.
