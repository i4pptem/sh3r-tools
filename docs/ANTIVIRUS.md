# Antivirus reports and verification

## Sample identity and release numbering

Development snapshots labelled 1.0.1 through 1.0.4 were consolidated into the public **1.0.1** release. Historical filenames and hashes below are retained exactly as reported. The earlier `Silent-Hill-3-Tools-1.0.1-win-x64.zip` has the same filename as the new release but different contents: identify a sample by **SHA-256**, not its filename alone. The historical samples have been preserved locally. No new scan result is implied by the release numbering.

## Investigated sample

The first reported sample is the development archive **Silent-Hill-3-Tools-1.0.1-win-x64.zip** with the following exact hash, not the 1.0.0 release.

```text
SHA-256: 636f6b4f266304eda366402e683e8abee8bf50e38cc7af10b733c212f6f06ee8
Reported detections: Trojan.Draftor.D52C4; Gen:Variant.Draftor.21188
```

[VirusTotal report](https://www.virustotal.com/gui/file/636f6b4f266304eda366402e683e8abee8bf50e38cc7af10b733c212f6f06ee8)

The maintainer supplied those detection names. Automated access to the report returned HTTP 429; the investigation did not establish the full engine list, detection count or which contained bytes triggered the alert. The maintainer did not find a flagged member in Bundled files. This is insufficient to conclude that a specific DLL, the EXE, or ZIP compression caused the detections.

## Continued detections on development snapshot 1.0.2

The maintainer also reported the following exact archive:

```text
Silent-Hill-3-Tools-1.0.2-win-x64.zip
SHA-256: 92eed8e31394d7e09e3e7379aa8cb5a93564d78f42e8300a553b3a1d4bd7cc3e
```

[VirusTotal report for 1.0.2](https://www.virustotal.com/gui/file/92eed8e31394d7e09e3e7379aa8cb5a93564d78f42e8300a553b3a1d4bd7cc3e/details). The table below transcribes the maintainer's report; automated report retrieval was unavailable. It is not a claim about the report's current state.

| Vendor | Reported label |
| --- | --- |
| ALYac | Gen:Variant.Draftor.21188 |
| Arcabit | Trojan.Draftor.D52C4 |
| BitDefender | Gen:Variant.Draftor.21188 |
| CTX | Zip.unknown.draftor |
| Emsisoft | Gen:Variant.Draftor.21188 (B) |
| GData | Gen:Variant.Draftor.21188 |
| VIPRE | Gen:Variant.Draftor.21188 |

The detections persisted on the development snapshots. Similar labels do not identify the offending member or prove that all detections are independent. The 1.0.2 ZIP was also scanned by Microsoft Defender with signature 1.459.537.0 and no threats were reported. This does not resolve the listed vendors' findings. The subsequent batch-replacement work did not alter the native binaries or provide a confirmed antivirus remediation.

## Checks performed on 2026-10-04

- The local ZIP hash matches the reported sample. The release ZIP inventory was verified byte-for-byte against its packaged files.
- The cached **Electron 44.4.3 win32-x64** download matches the publisher's [SHASUMS256.txt](https://github.com/electron/electron/releases/download/v44.4.3/SHASUMS256.txt): `790a355b684d5c7cc8dc3cdd8c4cca7c4b2d054685427c7554a956879a82e70b`.
- All **70 unchanged Electron files** match the upstream archive byte-for-byte. The packaged EXE differs only in its `.rsrc` section; its executable sections match upstream. The application packager supplies the product name, version and icon. This comparison concerns the Electron runtime, not every possible behavior of the application JavaScript.
- **SH3Tools.dll** and **SH3ToolsLoader.asi** were independently rebuilt with the documented MSVC recipe. Both match the bytes embedded in the original reported development sample exactly:

| Component | SHA-256 |
| --- | --- |
| SH3Tools.dll | `ebc226cce2ef71eecc86228d010db6ab29934646de72e04a10c0133870d10018` |
| SH3ToolsLoader.asi | `d8db25845871a40e6e57b778a2518082823098f040751336afb01adee3677fef` |

- **Microsoft Defender**, signature **1.459.537.0**, completed a custom scan of the exact ZIP and reported no threats (exit code 0). The scan used report-only mode without changing protection settings. A negative result from one engine does not overrule other engines.
- **Ultimate ASI Loader's dinput8.dll is absent from the portable ZIP.** It is downloaded only when the user selects its Build Mod option; both its pinned publisher archive and extracted DLL are SHA-256 checked. The tool's own runtime plugin is included in its source profile and is written into generated mods.

## Status and next steps

No runtime substitution was found by these provenance checks. A false positive is plausible, but **the exact Draftor trigger and the vendor's classification are still unconfirmed**. The folder-persistence and batch-replacement changes do not claim to fix antivirus signatures. The original reported samples are retained for comparison.

The portable application is currently unsigned. [Authenticode signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) would establish publisher identity and integrity; it is not a guarantee that antivirus detections disappear. No trusted signing certificate has been configured for this release.

For a vendor review, provide the exact sample hash, detection names, VirusTotal link, source repository and these verification results. Bitdefender provides an [incorrect-detection submission form](https://www.bitdefender.com/consumer/support/answer/29358/). Request the affected internal file or signature evidence if the alert identifies only the archive. A review request has not been sent automatically.

Keep antivirus protection enabled. Do not add blanket exclusions or alter binaries just to change their detection hash. A changed hash or a clean result from a different file is not validation of the originally reported sample.

## Diagnostic sample separation

For the maintainer's local investigation, the exact 1.0.2 ZIP was divided into inspection-only groups: the executable, native patch profiles, application source/docs, dependencies, and remaining Electron runtime/package files. Every member retained its original bytes and was checked against a SHA-256 inventory. A sixth sample contains the plugin DLL and ASI decoded from that release's original profile, with their published hashes verified. These groups are not runnable releases or replacement binaries, and a clean subset does not prove the original archive clean. No samples or review messages have been submitted automatically.

## Maintainer follow-up: both component groups detected

On 2026-10-04 the maintainer reported detections on **both** diagnostic samples:

| Diagnostic archive | SHA-256 |
| --- | --- |
| 02-native-patch-profiles.zip | `88724515d1059b4c4f221cfdc2e30597807d290b88521ab5f11b2fb55ffdfdf5` |
| 06-embedded-plugin-binaries.zip | `b1cd518157b190df69bcafd2a360e3940efb9c682046b4218f628612fac9bc6f` |

This establishes that the reported detection is reproducible in these subsets without the Electron executable. It does **not** establish that Electron or the other subsets are clear; those results were not supplied.

The samples overlap: `02` includes the JSON profile containing the same DLL/ASI bytes that `06` exposes as binaries, along with other patch profiles. The same component may therefore explain both reports. The maintainer subsequently confirmed **Draftor on `SH3Tools.dll` itself** and **four generic Malicious detections on `SH3ToolsLoader.asi`**. The four loader vendors and exact per-engine labels have not been supplied. These are separate file-level results, not an inference from the ZIPs. Unchanged copies of those two files have been prepared with SHA-256 checksums for component-level vendor review.

Both binaries match the independent MSVC rebuild. Their PE imports refer to Windows system libraries, ASLR/DEP are enabled, and neither has a section simultaneously marked writable and executable. Source review confirms intentional current-process patching and scoped archive-read hooks in the DLL; the ASI initializer loads the adjacent DLL by an absolute path with a restricted library search. These observations explain the intended behavior and build provenance, but neither identify the Draftor signature nor certify the absence of malware. The report is still unresolved; no speculative binary change is presented as a fix.


The runtime DLL's exact bytes are shared by development snapshots **1.0.1–1.0.4** and the consolidated public **1.0.1** release; the loader is also unchanged from **1.0.0**. Consequently, the consolidated release does not contain a native-plugin change that resolves these reports. File-level results are attributed to the maintainer; direct online report retrieval was unavailable.

Separate, unchanged DLL and ASI sample ZIPs and draft review requests have been prepared, with matching source files, build instructions and a technical audit. Nothing has been submitted to vendors. The primary next step is classification review by the detecting vendors, starting with the confirmed Draftor sample. The [Bitdefender review instructions](https://www.bitdefender.com/business/support/en/77209-343054-resolving-legitimate-applications-detected-as-threats-by-bitdefender.html) describe how to submit a detected file for analysis. Generic loader detections need the corresponding vendor names before targeted submissions. Binary provenance and source review do not substitute for a vendor determination.
