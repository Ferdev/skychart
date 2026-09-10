# Exhaustive storage investigation continuation

User rejected earlier completion. No complete_session until every catalogue and all serving artifacts measured, or genuine external blocker after alternatives. Existing resources only; no production writes/spend. One agent.

52-entry checklist: docs/catalog-storage-exhaustive-checklist.md; ledger data/catalog-registry/exhaustive-storage-ledger.json. All saved plans 4/5/6 pinned in saved-plans-storage-scope.json. 30 registry products plus 22 integrations/named references; unresolved releases remain in scope. Prior XSC evidence reused.

ACTIVE process: unified exec session 81186, scripts/measure_gaia_full_partitions.py, stdout data/storage-exhaustive-1271/gaia-full/run.log. All 3386 full source files, 152 columns, checksummed, streaming Parquet then all-field second-pass verification, fsynced receipts, recycle only newly owned download/output. 100GiB free headroom, 768MiB cgroup, 0.5CPU. First fullfile 528333rows,352304048bytes,52.64s plus4.2s download. Estimate50–60hours (not a storage estimate). Second file518501rows347000152bytes51.70s passed. Current progress.json and receipts are authoritative. First external source preserved. Scripts guard source MD5/schema/order, fsync receipts before recycling. Tests1pass meaningful fullfields/largeID/null/negativeparallax/corruptsource.

The Gaia run measures DETAIL ONLY. Global routing/index/crossmatch/physical/angular render artifacts UNBUILT; do not mark done after3386 receipts. Current receipt row-group ID ranges retained for routing; other scientific projections need second pass or source re-fetch to build full serving artifacts. Count final release1811709771 and source/input hashes before detail completeness. Aggregate export must remain INCOMPLETE for serving total. No full Gaia total yet.

Acquisition probes data/storage-exhaustive-1271/acquisition/: PSC92 gzip bulk files, official60-field schema + verification sums pinned. SIMBAD capabilities reachable hard2M rows1080s default3600s hard; guide404 mirror500. Need investigate supported consistent export, no naive paged mutable snapshot completeness. TNS obsolete URL404; official Sept2025 PDF search gives authenticated daily fullCSV path (API key requirement verify); don't treat as exhausted. Panstarrs oldbulk404; official MAST API/TAP docs and VizieR II/389/ps1_dr2 alternative found, need verify allschema/product equivalence. All30 registrydoc probes finished, receipts inregistry-docs; VSX403 needs officialCDSmirror alternatives; othersmostly200. ATNF official page2.8.1; SNR2024October.

OpenNGC pinnedcommit36cb178a0f69dba8bfc03a99c10512831edf1c6b fullCSV acquired 13969rows32columns3876288bytes; guide2935bytes. LICENSE filename404; resolve actuallicensefile. receipt.json preserved and copiedledger. Full serving stillpending.

Next independent work whileGaia worker runs: resolve all52 release/schema/acquisition paths, complete source inventories/checksums; implement PSC sequential fullmeasure afterGaia (or carefully reserveCPU for metadata only), AllWISE full conversion+globalartifacts notproviderbytesonly, SIMBAD consistentexport, everyotherentry. Authoritative sources linked inledger/report. Longrunsauthorized, prior4GiB/20minlimitsNOTuserconstraints. No tests/build constitutescompletion. Last status is wait forownliveworker, neverblockedmerely becausehoursneeded.

## Latest continuation checkpoint

The unified-exec Gaia worker DID NOT survive the previous turn: no process existed and only3receipts. Resumed with subprocess.Popen(start_new_session=True,stdin=DEVNULL,stdout=run.log). Current detachedGaia PID17887; confirmed advancement to9files/4676919rows (not just checkpointpresence). Nextturn MUSTcheckactualprocess andprogressagain; detachedsurvival acrossturn remains toverify.

Second detached I/O acquisition PID18485: scripts/acquire_catalog_source_manifest.py data/catalog-registry/additional-source-acquisition-manifest.json data/storage-exhaustive-1271/additional-sources.70explicit source/supportfiles from13CDS products; documented358MBuncompressedexpected(notmeasured), estimated6–15min.48verified,0failed atcheckpoint. Sequentialdownloads andboundedstreamcounts, noDB/indexconversionconcurrent withGaia. Sourcefieldschemas pinnedCDSReadMes. Inspectlog/receipts andfinish failures viaofficialmirrors ifneeded.

FullHipparcos main acquired118218rows53316318bytesSHA58ceabb104d647160d9437ce6e513a02a036bb4ad9f8879a5a22fd52943616e0; gzipURL404correctfileplain.dat. ATNF2.8.1package1427033bytes; psrcat.db10432859bytes4393records matchesheader4393. OpenNGC actuallicenseLICENSES/CC-BY-SA-4.0.txt18375bytes acquired. AllSOURCEONLY servingpending.

CDSReadMes/access probes now data/storage-exhaustive-1271/access-followup plusextra-catalog-docs. VSXfullsnapshot2026-08-23 declared10304679rows209width plusrefs830415. DirectVSXhomepage403 butCDSReadMeandlistingaccessible; actualvsx.dat notgz. PS1CDSII/389onlyps1_dr2.sam1000rowsdownload vsquerycatalog1868236315; cannotuseassizeofcompleteObjectThin. VirgoVII/85path404needcorrectcatalogresolution. ExtraCDSproducts receipts preservecandidateIDs/releases, schemaequivalencepending. 3cVIII/1Aincludes3c/3cr. NEDofficialTAPguidefound https://ned.ipac.caltech.edu/Documents/Guides/Interface/TAP (nextinspectcapabilities/snapshots).

New repeatable progress report command: python3 scripts/report_exhaustive_storage_progress.py. Updatestrackedexhaustiveledger withcompletefilecounts/bytes ONLY; fullsource/fullservingremainnull. MostrecentGaia9files detail3126099140source2070915607bytes, NOT fulltotals. Lastgitdiffcheckpassed. DoNOTcallcomplete_session.

## Most recent continuation — retained projections and routing

Detached worker DID survive turn boundary; oldPID17887progress11 then13files. Intentionally stopped withSIGINT to add missing global-build inputs early, avoiding fullGaiaredownload later. New ACTIVE Gaia PID20206, detached, worker.json authoritative. Added build_projection():15fields, nativeECSVtypes (doubleRA/Dec/parallax/pm; declaredfloat32quality/photometry/RV), IDDELTA_BINARY_PACKED, zstd3, twoCSVpasses andfullprojectionvaluechecks. Originalfull152fieldDETAILformat unchanged. Firstprojectionv2 30776534bytes/528333rows20.17sec. Firstf64candidate47MBpreservedexperiment. Estimate70–80h now, projectionworkspace~100–120GB (estimateonly),100GiBheadroomguard. Backfilledonlyprojectionsforearlier13fullmeasuredfiles, reusedtheirreceipts. All15currentcompletedfileshaveprojections:7739400rows detail5155828418source3413599832bytes, retainedprojection450412380bytes. Fulltotalstillnull.

New detached observer PID20733 watchesGaiaPID20206/rootdata/storage-exhaustive-1271 every10sec untilprocessends; outputworkspace-observed-peak.json. Beforemakingchangescheckactualprocessalive. Monitorusesexistingwatch_catalog_scratch.py extendedallowlist/duration/interval. Noexactpeakclaim(startedlate,sampled).

70additionalfilesDONE; nofailure. Download97573157bytes/uncompressed348948151/allocated97726464. Max6dfrecordwidth178matchesReadMe; trailingblanktrimcausesvarwidths(nottruncatedschema).

New scripts/build_gaia_id_routing.py realSQLiteIDrange→file,rowgroup routing, incrementalwithmanifestpin,overlaprejectioninsidefiletransaction,counts/integrity. Alreadybuilt id-routing.sqlite for13files,274432logical/278528allocated. CandidateIDrange != confirmedobjectexistence; mustcheckIDindetailrowgroup. Allotherglobalartifactsstillpending. Canrerunbuilderoncheckpointtoextendindex. tests/gaia_id_routing_storage_test.py ensureslargeIDs,idempotence,overlaprollback. Fullstorage tests(2) +routingtest(1)passed3total.

PSC HEADinventorycomplete92files (provider-reported42672321835B,NOTmeasured). PinnedJSONacquisition/psc-complete-file-inventory.json. Firstsourcepsc_aaa.gzdownloaded492966434B,73.8s,sha0119aa14ffd89f75c8634fbdc167012985ae0d904c755131ac447a13d39c7a7a; nofullrow/CRCverification/conversionyet. Nextimplementfull60-fieldPSCsequentialadapter, keeprawfields/scientificuncertainty, verifiedsourceintegerchecks. Fullfirstfilebenchmarkneededbeforewhole92run. Memory768MiB, Gaia~293MiB plusobserver22MiB. MainGaiaCPU~0.45 on0.5quota; avoidunplannedheavyconcurrency.

Report script updatedtoinclude projections,IDroutingreceipt,PSCmetadata/download,observedworkspace; rerunpython3 scripts/report_exhaustive_storage_progress.py. Oldestnotesruntime50–60h obsolete revised70–80. DoNOTcomplete_session; all52catalogs andfullglobal artifactsrequired. Nextcontinueunresolvedacquisitionpaths, PSCadapter, fullAllWISE source/artifacts (notmetadata), completeSIMBADexport, remainingregistry/provenanceentries.

## Latest PSC full-file trial and launch

GaiaPID20206 andobserver20733 survivedcontinuation. FullPSC firstfileCOMPLETEtrial:5144500rows60fields,allvaluescheckedagainstsecondCSVpass+projectionvalues+gzipCRC. source492966434B; detail548502557B/allocated548507648; projection172575362B/allocated172580864. seconds241.694 withGaiaCPUsharing; peakRSS298228KiB,oom_kill0. SourceSHA0119aa... priorreceiptvalid. Fixtures testPSCallfields,nullJmag,truezeroHmag,leadingzeroqualityflags,ID1234567890,malformedcolumncountpassed. Newfixturetests/fixtures/psc-schema.sql isofficial60-fieldschema.

ACTIVE newdetached PSC PID22956: scripts/measure_psc_full_partitions.py --root data/storage-exhaustive-1271/psc-full --manifest data/storage-exhaustive-1271/acquisition/psc-complete-file-inventory.json --schema data/storage-exhaustive-1271/acquisition/psc-schema --existing-source data/storage-exhaustive-1271/acquisition/psc_aaa.gz --max-files0 (actualcommand hasseparate0). Worker.json/log/progress.json/receiptsauthoritative. Scriptvalidatesownershipmarker,pinnedschema/manifest,sourcebytes,gzipCRC,all60fieldssecondpass,and16integerchecksums. Per-fileprogress; durableverifiedreceiptbeforeownedtempdelete; retainedbuildinputs. Resumevalidatesretainedprojectionexistence,size. Networkretry4attempts,100GiBfreeguard. Full92mustsum470992970and16IRSApublishedintegers; evenCOMPLETE_DETAIL_COMPONENTnevermeansfullserving. Estimate8–10hoursundersharedhalfCPU. Combinedmemory~450–600MiBwithin768MiB,noheavythirdconversion/testingwhilebothpeak. PSCprojectionsestimate~16GB; builditsglobalartifactsandretireinputsafter8hbeforeGaiaworkspace100GB. Wholeprojectspacecombinedneedsmonitoring;guardstopsbeforeliveheadroom.

Gaialatest25files/12935541rows atcheckpoint; fullprogressreportscriptupdatedPSCandmetadatareads. A fewnewPSCmanifestvalidationlinesaddedafterworkerstart(applynextresume; currentmanifestknownvalid). Tests1passedPSCafterlogicchanges,pycompile/diffcheckclean.

Acquisitionfollowup: SIMBADSELECTcount(*)AS n FROM basic succeededreports22152883rows (providerreported,notimported); firstqueryaliasrows/maxvarchar400so v2errorresolved. Schema67basiccolumns,ident2. hardoutput2m stillconsistentfullsnapshotpathunresolved. NEDofficialoldTAPdocs statelegacyAPIcannotaccesspostJan2026data; newAPIhttps://ned.ipac.caltech.edu/Docs::API/ specificationJul09,2026primarilyobject/conesearch; needsfullbulkreleasepath. DoNOTclaimoldTAPfullcurrentNED.

SurveyFITSHEADproviderbytes only:DESIDR1zall22371272640B;eROSITAmain2139595200B;LS10counterparts1053710795B;SPIDERS107196480B;QuaiaHEADtimeoutretryofficialZenodoAPI. data/storage-exhaustive-1271/acquisition/survey-fits-heads.json. NoFITSsourcesdownloadedinthisturn. Needfullschemas/releases/fullmeasurementallremaining52catalogueentries+globalserving,nohandoffcompletion.

Latest continuation: Gaia PID20206 and PSC PID22956 alive, observer20733.
Gaia30 files/15508373rows; router29files/14994168rows585728bytes.
PSC2files/10289000rows. SPIDERS full source downloaded107196480B;
receipt acquisition/spiders-dr20-source-receipt.json, schema/rows still pending.
VSX archive listing saved access-followup/vsx-versions; latest2025-11-03,
not current2026-08-23. Quaia API timeout recorded. Reporter includes these.
No foreground tool sessions left. Diskfree227.5GB, cgroupoom/kill0.
Plan top status corrected to INCOMPLETE. .rondar/ is untracked: do not ship.

SPIDERS source audit now DONE: scripts/audit_fits_source.py rehashes source,
checks block/HDU extents, reads ALL table fields bounded1024rows, counts
nonfinite/intnull entries and pins fullheader/schema. fitsio1.2.8 alreadyvenv.
263310rows49fields; existingimporter17cols insufficient. Audit5.60seconds.
Receipt acquisition/spiders-dr20-fits-audit.json; reporterupdatesSPIDERSsource.
New tests/fits_source_audit_test.py passed(fullarrays/nulls/int64/checksum/truncation).
No normalizedconversion launched whileGaia/PSCshare768MiB. Workerscontinue.

Continuation: Gaia33files17046508rows; PSC4files20578000rows; bothPIDsactive.
VCC resolved J/AJ/90/1681, full2096rowsgzip34447B/uncompressed146720B,
acquiredby scripts/acquire_catalog_source_manifest.py using tracked
virgo-source-acquisition-manifest.json; rootdata/storage-exhaustive-1271/virgo-source.
ReadMe under access-followup/virgo-readme-resolved pinsB1950 andHRV0null.
VII/85A candidate is Hickson, rejected. Reporter and checklistupdated.
Quaia sevenproducts pinnedproviderMD5s in quaia-source-products.json.
G20.0subset755850 vs G20.5full1295502 providerrows notunique summed.
DirectIPv4HEAD25sec0bytestimeout; API/normaldirectalsotimedout. Webtoolcanread
recordmetadata. Stillneedresolveaccessiblefullacquisition. Noforegroundsessions.

Latest continuation: Gaia36files18574193rows; PSC4files20578000rows; workersactive.
New scripts/build_psc_lookup.py prepared NOT fullvolumerun: ownedPSCdir only,
sourcefile atomictransactions, hashverifiedprojections, pts_keyPK,
designationindex, exactdoubleRAdec + Rtree, detailfile/group/offsetlocator.
Counts+integrity+rtreecheck, finalrequires92files470992970rows. Noextkeycrossmatch
orIRphotometry/renderartifact yet. Fullindexsize+runtimeUNKNOWN untiltrial.
Fixture tests/psc_lookup_storage_test.py passes2.80s with missingcoords,ID>2^53,
duplicateIDrollback preservingpriorfiles, resumehashstable. Do not confuse
preparedcode with measuredstructures. First5.14mfiletrial queued behind
memoryintensiveworkers; command inchecklist+ledger psc_global_lookup_build.
Memorycurrent791613440 (pagecacheincluded), max805306368; noOOM earlier.
No foregroundsessionsleft. WorkscopeINCOMPLETE. Waitonexistingworkers.

Latest continuation: Gaia38files19582625rows; PSC5files25722500rows.
Gaia actualrouting37files19079186rows741376logicalB/745472allocatedB.
Added docs/catalog-storage-measured-progress.md GENERATED by reporter,
52/52registryentriesinorder verifiedreadback, nofulltotal; groups70complete
additionalfiles into13catalogfamilies as acquired_file_set (doesNOTclaimfull
releaseequivalence). Fullsourcefacts OpenNGC andATNF now inentryartifacts too.
Reporter refusesunknowncatalog receipt/duplicateinventory ID. Table links
fromexhaustivechecklist. Userhasclickabletablelink. compile+diffcheckpassed.
No foregroundsessions. Bothdetachedworkersactive; continuecatalogacquisition
andlaterPSClookuptrialwhenmemoryheadroom. FullscopeINCOMPLETE.

LatestcontinuationGaia40files20598612rows,PSC6files30867000rows,bothactive,noOOM.
SNRresolvedGreen2024Oct/CDSVII/297 fullsnrs.dat310rows19799B, ownedsnr-source.
Trackedmanifest snr-source-acquisition-manifest.json; sourceReadMeaccess-followup/snr-readme.
AcquiredpublisherbulkPDFs snr-catalogue2024-tables.pdf203465B(33pages),
snr-catalogue2024-table-V.pdf445332B(122pages), detailedrefs+candidatecoverage.
Installedpypdf6.1.1 in existingvenv only(no trackedrequirementschanges).
Strictfullpageextractpassed, originalPDFs+text+checksumsreceiptsretained;
text extractionnotlosslessreplacement. SNRsourceentrymeasuredfullsummary,
detailedfacts/candidates normalizationandallservingpending. ReporterincludesPDFreceipts.
No foregroundsessionsremain. Nextcontinueothercatalogacquisitionwhile2workersrun.

LatestcontinuationGaia42files21608999rows;PSC7files36011500rows;bothactive.
HEASARCNEARGALCAT acquired fullTDAT via officialFTP URL inreceipt.
rootneargalcat-source/full.tdat.gz68385B,uncompressed171443B869rows40fields,
gzipCRC/endmarker/rowwidth/uniquenamesverified. Export2020-09-30 modified2020-09-28,
originaltableJune2013. Fullfits attemptedTAPreturned386BXMLunsupportedformat,
receiptREJECTED_query_error; don'ttreatasFITS. Positive distanceall869(nocutloss).
Exactnamesjoin toCDSLocalVolumeJ/AJ/145/101table1all869; all distancesmatch;
maxRA3.334e-9degDEC4.445e-9deg. samepublishedinputtables. No identitymutation,
otherfieldtranslationspending. overlapJSONbothhashes. Reporter/table/checklistupdated.
No foregroundsessions. Continueacquisitionremainingcatalogs; currentlongworkersactive.

LatestcontinuationCTAresolvedPASP72,237HarrisRoberts1960DOI10.1086/127521.
CaltechrepositoryDOI403, alternativeNASAADSfullPDFdownloadsuccess1260582B19pages
access-followup/cta-paper.pdf;receipt+text. pypdfallpagesextracted withXrefcorrectwarning.
Paperstates106entries90from3C(PROVIDERCOUNTSnotvalidatedrows),1950coords.
TableOCRunvalidated—needactualscientificrowtranscription+checks; sourcebytesmeasured.
APM officialparentdocs fetched/hashed: POSS-I+UKST, notBrightGalaxycatalog.
Discoverypaperarxiv9806171HTMLsuccess; confirmscarbonstarsurveyoriginoflandmark.
Officialquerynotesonlyfieldqueries; preciseparentrelease/bulkpathstillunresolved.
ReporterincludesCTA/APM evidenceandchecklistscope; no new sourcebulkworkers.
No foregroundsessions; Gaia20206PSC22956continue. FullscopeINCOMPLETE.

LatestcontinuationGaia48files24650256rows. THREE detachedworkersnow:
Gaia20206,PSC22956,observer20733 and light exoplanetdownload37432(RSS30MB).
Exoplanetfirst VOTableallquery hitsinternal128MiBguard, countbefore/after6360;
failed source at exoplanets-source/pscomppars.vot.partial, NOTcomplete.
Newdetachedretry removesbytecap usesfree100GiBfloor; scripts/download_exoplanet_storage_source.py
rootexoplanets-source/retry-full, logexoplanets-source/retry-full.log,workerJSONpid37432.
Mustmonitor thisworker completionNEXTTURN inadditionGaiaPSC. Full703fields,
expected6360providerrows. It downloadsthen runs audit_votable_source.py,
rowwidth+FIELDmetadata+nullcounts+allQUERY_STATUS OK, nooverflow. ~severalminutes.
Newtests/votable_source_audit_test.py passednull/unit/overflow/rowwidthfixture.
Originalforedownloadsession92524ended; alltoolforegroundsessionsclosed.
Existingkernels measuredJSONexisting-kernel-measurements.json:
DE440s32726016B14segments,MAR099s67594240B7segments; SHA+targetcenterframeepoch.
Countssegmentsnotobjects, othercuratedmetadata/cache/servingpending.
Reporterincludeskernel+exoplanetprogress/finalreceiptwhenavailable.
FullscopeINCOMPLETE. Keepwaitingownjobs, nohandoff.

Latestcontinuation: Gaia51files26186215rows;PSC10files51445000rows.
EXOPLANET DONEsource: PID37432exitedsuccessfully;retry-full/receipt.json.
6360rows703fields169497514B allocated169504768;SHA05a3d85647ca7af16cf715bb3f4f7b42a0a1d004d33c30be93f1e0d0d7901b26;
389.65sdownload+audit;28emptydistance,324stellarradii,50planetradii.
Fullquerydatedsnapshot,noimmutableupstreamreleasenamed. Normalized/servingstillpending.
NEW FULL SBDB workerPID38914 alive started~21:12UTC, logsmall-body-source/full-run.log,
root small-body-source/full, scriptdownload_sbdb_storage_source.py.
All79infofields+kindextra(verifiedAPI),fullprec=true,sortspkid,NOlimit/filter.
Provider1567287count. 1k pilot704875B8.01s;10k7448649B10.81s. Estimated1.2GB10–40min
publishedbeforelaunch. OneAPIrequestatime: DO NOTlaunchotherJPLAPIrequestswhile38914runs.
SourceJSONstreaming+ijson3.4.0.post0(installedvenvonly);boundedrowauditfields/count/strictmonotonic
SPKID, fullsourceSHA. Interruptedqueryrestartwhole; fullydownloadedrawreusedforaudit.
Tests/sbdb_source_audit_test.py passedlosslessID/duplicate/fullcount mismatch. No normalized
heavyconversionlaunched. Watchprogress/log/PID;currentlyREQUESTING awaitingheaders normal.
ReporterincludesSBDBmetadata/pilots/progress/finalreceiptwhenavailable. Allforegroundsessionsclosed.
ActiveGaia20206PSC22956observer20733SBDB38914. Noagents/spend/deployment/DBwrites.

CRITICAL LATEST CONTINUATION:
Gaia57files29236858rows;PSC12files61734000rows. LocalPIDsGaia20206PSC22956
observer20733VSX40442. VSXdownloadfull2.164GB started~21:17UTC, rootvsx-source/full,
logvsx-source/run.log, expected10304679rows width209 B/vsx2026-08-23. manifesttracked.
SBDB LOCAL38914 EXITEDFAILED: ijso prematureEOF after1079326989B. Rawfull.jsonretained,
progressINCOMPLETE_INVALID_SOURCE. gzip pilot returnednoencoding (unsupportedcompression).
DO NOT describe localSBDBasrunning orcomplete. Exoplanet37432alreadyDONE6360rows703cols.

NEW REMOTE jobs authorizedexistingresourcesonly / isolatedfiles (sharedDBsuntouched):
SSH alias sk-apps-server-1 works. Existinguid1000sudo-n available. roottempdir
/tmp/skychart-storage-1271-psc-index. Capacity59.7GBavailableRAM260.9GBfreedisk8cores
load0.13 idle82–95%; followupload0.81 free260.2GB. No systempackagesinstalled.
TemporaryvenvPython3.12ensurepipmissing solved --without-pip + officialpip.pyz
inside tempdir. Installedpyarrow20.0.0 PyYaml6.0.2 ijson3.4.0.post0onlythere.
UserunitfailedtopersistafterSSH(no lingerchanged); SYSTEMtransientunitswork, uid/gid1000:
1) skychart-storage-1271-psc-trial.service PID1395565(last), maxCPU25000/100000,
MemoryMax536870912,MemorySwapMax0,Nice19,IOWeight1,RemainAfterExit=yes.
Runs scripts/build_psc_lookup.py data/storage-exhaustive-1271/psc-full
 data/storage-exhaustive-1271/psc-full/lookup.sqlite --max-files1 (space before1!).
CopiedonlyfirstverifiedPSCreceipt/projection(172575362B5144500rows)+fullmanifestOWNER.
Log trial.log in tempdir. Need pollsystemctl SubState=running vs exited/failed,
thenretrieve lookup.receipt.json andmeasureactualtrial beforefullrun. No fullservingclaim.
2) skychart-storage-1271-sbdb-retry.service PID1397506(last), CPU25000/100000,
MemoryMax134217728, otherlimitsasabove. New independentnetwork full SBDBquery,
root data/storage-exhaustive-1271/small-body-source/full, logsbdb.log in tempdir.
Sameall80fields code copied. Need retrievefinalreceipt/download/progress tolocal
newremote-evidence location, DON'Toverwritefailedlocalattempt. No otherJPLAPIcall
while thisrequestactive. If completescomparefullcount1.567m; don'tinferfrombytes.

Actualcgroupsreadback /sys/fs/cgroup/system.slice/UNIT/cpu.max memory.max verified.
Remotejobfacts savedlocal psc-remote-trial.json sbdb-remote-retry.json; reporterreads.
Bothremoteservicesactive/runningatlastcheck. NeedstoponlyOWNcompletedunits later
becauseRemainAfterExit=yes; notproductionservices. No code deployment.
Allforegroundtool sessionsclosed. Keepworkingandwaitonrunningjobs; exhaustiveINCOMPLETE.

## Continuation 21:40 UTC, 2026-09-09
- Local Gaia/PSC/VSX confirmed active. Gaia last report 60/3386 files,30,807,820 rows; PSC13/92,66,878,500 rows. VSX1,531,969,536 downloaded bytes at21:34; not yet full audited main table.
- Remote SBDB retry FAILED premature EOF (ijson), response1,078,267,213 bytes in117.943s. No full receipt; do NOT report running. Failure recorded sbdb-remote-retry.json and reporter. Raw retained on Apps Server; first failed local raw retained separately. Download script now durably records audit failures; tests cover truncated exports and mandatory first-field SPKID (2 tests pass). Remote script running old version had stale AUDITING progress; actual systemd failed/log is authoritative.
- Safe SBDB alternative still to evaluate: documented sb-kind=a/c + sb-ns=n/u produces four exhaustive category exports, retains80fields, substantially smaller responses. Needs precise interval snapshot semantics, count/ID reconciliation and mutation detection; cannot claim atomic immutable snapshot just by summing category rows. Official docs https://ssd-api.jpl.nasa.gov/doc/sbdb_filter.html and /doc/sbdb_query.html. No JPL job remains active, so sequential probes can proceed.
- Remote PSC index trial still active integrity phase. First file insertion committed5,144,500 rows and angular rows in587.682s, SQLitecurrently971,100,160 bytes; final SHA/integrity receipt pending. MemoryPeak536870912, memory.events oom/oom_kill0, max4375. Preserve quarter-core/512MiB cap. Do not call current bytes final until receipt. Unit RemainAfterExit means active/exited is completed, active/running still working.
- Quaia independent Apps Server fullG20.5 HEAD also504. Evidence access-followup/quaia-apps-head.json included in ledger; full source remains unknown.
- Full VSX bibliography refs.dat dated2022-05-30 acquired separately (not same date as main table):830415rows,2542108compressed/23251390uncompressed/2543616allocatedB, SHA e175901b03f76f567f4cc073d496918ebf0b50cdf1d2fc5bb13dec278c855327,8.766s. Manifest data/catalog-registry/vsx-references-acquisition-manifest.json; receipt vsx-source/references/variables--refs.dat.json. Reporter includes evidence. Field audit/join still pending.
- No completion handoff; exhaustive52-entry scope, complete normalized data and serving artifacts remain incomplete. Source-only additions do not satisfy completion.

## Continuation 21:46 UTC
- PSC remote index trial FINISHED successfully (unit active/exited due RemainAfterExit). Receipt copied psc-remote-evidence/lookup.receipt.json:5,144,500rows,971100160logical/971104256allocatedB,SHAe5524acfc1411f1924bc3d83e7d121d14cdaf93fb340ce52c1636504cd00baac,1037.193s total,587.682s insert. Integrity and rtreecheck pass. Do NOT report trial as running anymore.
- New scripts/benchmark_psc_lookup.py ran read-only against isolated remote trial. Nine locator samples verified against projection;90 warmqueries each ID/designation/angular; p95ms0.03164/0.02368/0.10002. psc-remote-evidence/query-benchmark.json. No full detail hydration, cold/fullvolume/nativebudgets inferred. Reporter now shows partial trial index in PSC table.
- VSX main COMPLETED10,304,679rows,2163982590logical/2163990528allocatedB,SHA68e22e1fff473fe7914313d71d531b5443ff35bb9aedc0ac294e3ad4d750fe77,1412.771s. PID40442 exited. Postacquisition ReadMe unchanged; headers+hash vsx-source/post-acquisition-metadata.json. Field audits/IDs/joins/serving pending.
- New SBDB category worker ACTIVE on Apps Server unit skychart-storage-1271-sbdb-categories.service, same ownedworkdir /tmp/skychart-storage-1271-psc-index, logfile sbdb-categories.log; root data/storage-exhaustive-1271/sbdb-categories. Cmd venv/bin/python -u scripts/measure_sbdb_categories.py ROOT data/storage-exhaustive-1271/small-body-source/info-all.json. Verified CPU25000/100000, RAM134217728, swap0,Nice19IOWeight1, same isolateduid1000. Liveavailable255286095872disk/54050922496RAM atlaunch. Estimate10–30min published, not deadline.
- Four complete category queries sequential cn,cu,an,au with all80fields. cn/cu already verified (receipts being copied sbdb-category-evidence/cn.json,cu.json), an active lastcheck. No other JPL calls until workerdone. Updated source script accepts validated category and checks everyrowkind. Tests3pass including wrongcategoryandtruncatedJSON. Before/after provider info=count retained. Final measurement intentionally INCOMPLETE_GLOBAL_RECONCILIATION; full snapshot and serving null. ExactcrosscategoryIDs/mutationchecks still needed before claiming global coverage. Category acquisition localmetadata sbdb-categories-remote.json, reporter includes it. Original failed raw attempts untouched.
- Potential next step: full PSC global index incremental build on Apps Server. Trial implies ~15h insertion alone by linear extrapolation; full integrity costs/scaling not measured, estimate18–30h must be explicit if using. Full92 extrapolated index~89GB + retainedprojection~16GB may fit255GBfree with100GBfloor, but validate workspace/cost first, then run under same limits with ledger. Only first projection is currently remote! Need safe durable transfer of newly verified local projections/receipts while PSC worker produces rest; no shared DB. Do not claim full global structure by multiplying trial size.
- Latest Gaia64/3386files32,907,665rows,PSC stillactive (last14/92). Exhaustive52-entry scope INCOMPLETE. No completionhandoff. Compile/tests/diffcheckpassed thisturn.

## Continuation 21:50 UTC — full PSC global index started
- Remote full index unit skychart-storage-1271-psc-full-index.service is ACTIVE/running, same own workdir/root as completed trial. Command build_psc_lookup.py ROOT ROOT/lookup.sqlite --wait-for-files. Verified cpu.max25000/100000, memory.max536870912, swap0, Nice19, IOWeight1. Reuses existing trial index (no redo firstfile). No shared DB access.
- Added wait-for-files mode: consumes verified receipts sequentially as available; commits a whole input file atomically, stores lookup.progress.json. Final global integrity/counts/SHA only after all92files. Old lookup.receipt.json remains historical trial until replaced at end: use progress/log, never treat trialreceipt as current fullbuild result.
- Added sampled named-file workspace/journal tracking every10s during batches in lookup.workspace.json. Explicitly excludes unlinked/between-sample peaks (not exact instantaneous workspace). Diskguard100GiB checked everyrowgroup prevents consuming shared headroom. Perfile rollback on failure.
- Local detached syncworker PID46367: .venv/bin/python -u scripts/sync_psc_investigation_inputs.py data/storage-exhaustive-1271/psc-full sk-apps-server-1 /tmp/skychart-storage-1271-psc-index/data/storage-exhaustive-1271/psc-full. remote-sync.log/progress/worker.json underlocalPSCroot. SequentialSCP40Mbit/s capped; verifies ownrootandmanifest; remote existingreceiptSHA match skips firstfile; uploads .incoming then publishesprojection before receipt. Builder verifies projectionSHA prioringest. No localfilesdeleted. Firstpsc_aab uploading lastcheck.
- Published estimates BEFORElaunch: index~89GB+inputs~16GB;18–30h using trial timings. NOT measured full totals. Remote free254456639488B andavailableRAM53973569536B, load0.87/1.30/1.14. SQLite journal fullvolume unknown and may blockfit despite baseestimate. psc-full-index-remote.json records. Longer safe run authorized byuser.
- SBDBcategoryworker stillau active, numberedasteroids895910rowspassed. Needcollect an receiptandauwhenfinished +beforeaftercounts+measurement. Do not makeJPLrequests untilworkerfinishes. Full snapshotreconciliation stilloutstanding.
- Gaia+PSC localconverters remainactive, PSC15/92files77,167,500rows lastcheck. VSX and oldPSCtrial alreadyfinished, do notreportactive. TrialmetadatafixedstatusCOMPLETE_SINGLE_FILE_TRIAL. Reporter includesfullindexmetadata,syncprogress,VSXpostmetadata.
- PSCfocused test passed aftercodechanges, compile andgitdiffcheckpass. No completionhandoff; all52entryexhaustive scope remains incomplete.

## Continuation 21:56 UTC — SBDB category acquisition finished
- All4category exports completed successfully. Metadata before/after counts unchanged cn610,cu3466,an895910,au667301. Source bytes cn494423,cu2221166,an700589356,au510180406; sum1213485351B/1567287rows. NOT atomic snapshot proof or normalized/serving size. Full80fields each preserved and audited. FullsourceJSON retained remote root sbdb-categories. measurement+before/aftercount receipts copied local sbdb-category-evidence and included reporter. Category worker active/exited SUCCESS, do NOT report it still acquiring.
- New actual reconciliation worker ACTIVE/running: skychart-storage-1271-sbdb-reconcile.service onApps Server, sameownworkdir. Cmd venv/bin/python -u scripts/reconcile_sbdb_categories.py data/storage-exhaustive-1271/sbdb-categories. logfile sbdb-reconcile.log. CPU25000/100000,RAM134217728 verified,swap0,Nice19IOWeight1. Laststatus RECONCILING categoryan.
- Independent full census query fields=spkid,kind,orbit_id&full-prec=true&sort=spkid downloaded and auditpassed (worker now parsing categories). No otherJPLrequests while running. Census independent-census.json + receipt remote. SQLite reconciliation.sqlite is auditWORKSPACE, not servingartifact. Exact64bit IDs primarykey, duplicatecrosscategory fails; eachcategory transaction includescompletionmarker soresumesafe. SourceSHA rechecked. Final comparesall census IDs,kind,orbit_id and counts; stillcannotestablishall80values unchanged oratomicupstreamrelease. Final reconciliation.receipt.json/progress expected; collect oncefinished, don'tclaimsuccessuntilread.
- New tests/sbdb_reconciliation_test.py passes losslessID>2^53,duplicatecrosscategorytransactionrollback,changedorbit/missingID detection. py_compile + gitdiffcheck passed.
- FullPSCindex remainsrunning, firstadditionalpartition stillbuilding; syncworker46367continuessequentialtransfers; noerrorlogs. Journalworkspace observed~169MB earlysample, notfullscale. Gaia69/3386files35527816rows lastreport. PSCconverter20206(Gaia)/22956(PSC)active. VSX/oldPSCtrial/cometcategoryacquisition finished.
- Next independent useful work: captureSBDBreconciliation, then measure all80-field normalized ownedstorage and actualnative lookup/artifacts; currentauditSQLite is notserving. VSXallfieldaudit/normalization also pending. All52entryexhaustive scope remainsINCOMPLETE, no completionhandoff.

## Continuation 22:03 UTC — SBDB reconciliation verified; full-field storage retry
- SBDBreconciliation COMPLETEDsuccess in265.511s:1567287uniqueIDs matchindependentfullcensus,0kind/orbit/versiondifferences;before/aftercategorycountsagree. Receipt andcensusreceipt copied sbdb-category-evidence/{reconciliation,independent-census}.receipt.json; reporterincludesboth. AuditworkspaceSQLite25501696logical/25505792allocatedB,SHA2eb599846ae6000edff1fcb5158584625c74aaf42f14107f23ca606cc84b733c. This is auditworkspace, notserving. Othermutablephysicalfields/atomicupstreamsnapshot stillunproven. Do NOT reportreconciliationrunning anymore.
- New scriptmeasure_sbdb_owned_storage.py preservesall80fields inParquet(zstd3,no dictionary,4096rowgroups) +globalSQLiteID/routing+full_name/pdes/name aliases. Re-read every sourcefield againstParquet, source/outputSHA, globalaccounting/integrity,8offlinedetailhydrationsamples. Categorytransactionsresume, duplicateIDfails. No dynamicpositions/crosscatalogidentities/rendering/nativeAPI implied. Scientificmetadata allproviderfields retainedinParquetschema.
- FIRST storageattempt failedimmediately cn dueactualJSONtypes: spkid,sats,n_obs_used,n_del_obs_used,n_dop_obs_used areJSONintegers, notstrings. Failedroot sbdb-owned-storage retained (noacceptedconversionreceipt), unit skychart-storage-1271-sbdb-storage failed. Fixedcontractint64forthese5fields, originalstring/nullforallothers. tests/sbdb_owned_storage_test.py passed exacthighprecisiondecimalstrings,nullvszero,ID>2^53,aliasesandactualofflinelocator. Do NOT treatfailedattemptasmeasurement.
- RETRY launched on Apps Server unit skychart-storage-1271-sbdb-storage-typed.service, workdirsame /tmp/skychart-storage-1271-psc-index; root data/storage-exhaustive-1271/sbdb-owned-storage-typed, logfile sbdb-storage-typed.log. CPU25%,RAM512M,swap0,Nice19IOWeight1. Verifyactiveandprogress afterlaunch (tool session39490 pending atnote time). Newformat sbdb-all-fields-original-types-zstd3-rg4096-v1. Source1.213GB,free250400530432Bbeforelaunch;100GiBguard. Estimate10–30min announced. Localmetadata sbdb-storage-remote.jsonupdatedwithpriorfailure/typedretry.
- Gaia72files37,096,921rowslastreport. PSC17/92files87,456,500rows;localconverters20206/22956andinputsync46367active. FullPSCindexactive;workspaceearlysample5.1GBincludingcopiedinputs/journal314MB, notfullpeak. FullindexprogressmaystillshowWAITINGpsc_aabfrombeforecopyuntilcommit;actualsystemdrunning/workspacechanging indicatesactivelybuilding.
- Reporter nowdisplaySBDB1,213,485,351Bcategorysources in52entrytable withatomic-snapshotcaveat. Entireexhaustiveinvestigation remainsINCOMPLETE. New fullstoragecomponentstillinprogress; nativeglobalserving costnotmeasured. No completionhandoff.

## Continuation 22:09 UTC — VSX field audit prepared and source transferring
- Gaia75/3386files38,636,726rows. LocalGaia20206/PSC22956active. PSCfullindex hascommitted2files10,289,000rows,1,851,072,512logicalbytesatcheckpoint; secondfile626.591s. Fullintegrity/SHA onlyafterall92; do NOT reportpartialglobalbytesasfulltotal. Progress/workspace copiedpsc-remote-evidence/full-build-{progress,workspace}.json. Inputsync46367waitingforpsc_aas after18transferslastcheck.
- SBDB typed fullstorageworker stillactive,processingan,MemoryPeak512MiB. Noerrorlog, priorfaileduntypedattemptstillpreserved. Needcollectactualtypedmeasurementwhenfinished, verifytests/fullsourceofflinelookups beforeclaimingcomponentdone. Sourcesetglobalreconciliation alreadyfinishedlastturn.
- Added scripts/audit_cds_fixed_width.py: pinnedCDSbyte-range schema, allfields/rowsread, SHA,rowwidth+count, blanks vs realzero, numericformat exceptions countedwithoutdroppingrawrecords, lowcardinalityflag/banddistributions. No scientificnumericcoercion and no serving storage. tests/cds_fixed_width_audit_test.py passed blanks/zero/flags/malformednumeric/widthrejection. Scriptcompiled/diffcheckpass.
- VSX fullsource COPY is nowrunning detachedlocalSCP PID51368, bandwidth40Mbit/s. Local source vsx-source/full/variables--vsx.dat.source; destination AppsServer /tmp/skychart-storage-1271-psc-index/data/storage-exhaustive-1271/vsx-field-audit/vsx.dat.incoming. FolderOWNERSkyChartisolatedVSXfieldaudit1271; ReadMe alreadycopied, script remote scripts/audit_cds_fixed_width.py. Loglocalvsx-source/remote-transfer.log, workerJSONmetadata. Originalsource2,163,982,590B SHA68e22e1fff473fe7914313d71d531b5443ff35bb9aedc0ac294e3ad4d750fe77. Lastincoming68,413,440B confirmsgrowing. Estimate7–10mintransfer announcedbeforecopy, host249156993024Bfree/53844226048BavailableRAM,load1.19/1.53/1.44.
- IMPORTANT: VSX fieldaudit NOT launchedyet! AfterSCPexitsandfullsizeverified, run boundedremoteunit (CPU25%,RAM128M or512M,Nice19IOWeight1,swap0) using python3 scripts/audit_cds_fixed_width.py ROOT/vsx.dat.incoming ROOT/ReadMe vsx.dat 10304679 EXPECTED_SHA ROOT/fields.receipt.json. No othernewdownloadneeded. FullSHA checkedbyaudit; keep transferstatusINCOMPLETEuntilsuccess. Could renameownedincomingonceconfirmedclosed. No sharedDBtouch.
- Reporter includesVSXtransfermetadata afterrefresh. All52entryexhaustiveinvestigationremainsINCOMPLETE, servingtotalsunknown. No completionhandoff.

## Continuation 22:18 UTC — full AllWISE measurement running; VSX audit running
- Gaia80/3386files41,226,636rows. Gaia20206/PSC22956andPSCinputsync46367 remainactive. FullPSCindexremotestillactive; no newfinalreceipt. SBDBtypedstorageworker stillactive, nowau (an completed); VSXfieldaudit running. Exhaustive52catalog/artifacttable incomplete; no completionhandoff.
- VSXsource transferPID51368 FINISHED, remotefullsize2163982590B. Launched skychart-storage-1271-vsx-audit.service, sameownworkdir, CPU25%RAM128Mswap0Nice19IOWeight1. Cmd /usr/bin/python3 scripts/audit_cds_fixed_width.py data/storage-exhaustive-1271/vsx-field-audit/vsx.dat.incoming data/storage-exhaustive-1271/vsx-field-audit/ReadMe vsx.dat 10304679 68e22e1fff473fe7914313d71d531b5443ff35bb9aedc0ac294e3ad4d750fe77 data/storage-exhaustive-1271/vsx-field-audit/fields.receipt.json. Logvsx-audit.log. Lastunitrunning/noerrors. Metadata localvsx-source/remote-transfer-worker.json nowTRANSFER_FINISHED_FIELD_AUDIT_RUNNING. Needcollectfieldreceiptwhendone; exactsourceSHAcheckedbyaudit. Do NOT reporttransferstillactive.
- Implemented scripts/measure_allwise_full_partitions.py: all298fields preserved inZstd3/4096rowgroups +13columnbuildprojection (cntr,designation,ra,dec,w1..4mpro,ph_qual,cc_flags,ext_flg,n_2mass,tmass_key). ProviderMD5+perfile rowcounts, allfields/null/NaN/source/schema/projection verification, perfile source/detail/projectionSHA+byte receipts, removesONLY ownsource.tmp.parquet/detail.tmp.parquet afterfsyncedreceipt, projectionsretained. Original298fieldmetadata preserved; no opticalbrightnessorphysicaldepthinferred. Candidateencoding—notdeclaredfinalservingformat. Source schema.arrow fielddefinitionpin; receiptresumechecksformat/path/rowcount/MD5/projectionSHA. No arbitraryperfiletimeout/cap; request120sinactivity +100GiBfreeheadroomguard. Tests/allwise_full_measurement_test.py passed298fields,null/NaN/ID>2^53/metadata/countdrift. compile/diffcheckpass.
- Firstnewpartition0 fullmeasurementPASSED onApps Server:51536rows,24844419sourceB,28038895candidate detailB,1869170projectionB,18.907s. Unitallwise-first finishedSUCCESS, receiptcopiedallwise-remote-evidence/first-partition.json. Firstfiledeletessourcetemp/detailafterreceipt asintended.
- Reused priorcompletecandidate3partitions1091,8438,8274 WITHOUTredoingtheirconversions. New scripts/seed_allwise_prior_measurements.py verifiesprovidersourceMD5+priorSHA+rows andcreates/validatesonly13colprojections. Oldsourcefiles(97MBtotal) andmeasurementcopied remote allwise-prior/. Priorolderreceiptlacked byte_stream_split_floats; legacydefaultFalse supported. Seedfinishedreportedindices1091,8438,8274. Reusedreceipts includepreviousmeasurementSHAandorigin; seconds=None (don't sumwithoutfilter). Originalcompletedcandidatefilesstilllocalinallwise-zstd/.
- FULL AllWISEworker ACTIVE/running: skychart-storage-1271-allwise-full.service, root /tmp/skychart-storage-1271-psc-index/data/storage-exhaustive-1271/allwise-full, logfileallwise-full.log. Cmd venv/bin/python -u scripts/measure_allwise_full_partitions.py data/storage-exhaustive-1271/allwise-full data/storage-exhaustive-1271/allwise-manifests/allwise-parquet-row-counts.csv data/storage-exhaustive-1271/allwise-manifests/allwise-provider-md5.txt. InputsREADME/MD5/rowscopiedallwise-manifests/ frompriorpinned2023-04-10 release. Verifiedcpu.max25000/100000,RAM536870912,swap0Nice19IOWeight1. Providerexpected12288files747634026rows. Startedafterpublicestimate70–100h (notdeadline);projectionextrapolation27.1GB notmeasuredfull. Detaildoesnotcoexist; fullglobalindicesstillunbuilt. Existinghostfree~249GB; PSCindexworkspacemayeventuallyconsumeheadroomguard—do notdeclareallfits.
- LastAllWISEstatusACQUIRINGindex3; newlycompletedindex1/2 receiptsandfullvaluespassed (file2 13.501s). Seeded3 +new0/1/2 means6verifiedreceiptfiles, but readactualreceiptsnextturnratherthanoldcounts. Progress.jsonduringruniscurrentphase, notsummedreleaseprogress; exactsumneedsreadreceipts. Localallwise-full-remote.json pinsrunmetadata; reporterincludesrun+firstnewreceipt. Needperiodicremoteaggregate/copyreceiptsevidenceasruncontinues. No reuseofmetadata364GBasactualmeasuredsize.

## Continuation 22:23 UTC — remote receipt collector added
- All6measurementsstillactive: Gaia20206,PSC22956,remotePSCindex,remoteAllWISEfull,remoteSBDBtypedstorage(au),remoteVSXfieldaudit. PSCinputsync46367active. No completednewSBDB/VSXreceiptyet.
- Added scripts/collect_remote_storage_receipts.py: read-onlySSH ownroot check; fetches everycompletedAllWISEreceipt plusPSCglobalprogress/workspace,SBDBmeasurementwhenpresent,VSXfieldreceiptwhenpresent. SavescompletedAllWISEreceiptsimmutable locally andfailsifchanged; summaryexactlysumsonlyreceipts. Use `.venv/bin/python scripts/collect_remote_storage_receipts.py sk-apps-server-1 /tmp/skychart-storage-1271-psc-index/data/storage-exhaustive-1271 data/storage-exhaustive-1271` then `python3 scripts/report_exhaustive_storage_progress.py`. No applicationDB orremotewrites. FullcandidatesummaryremainsINCOMPLETE untilreview; collector doesn'tclaimfullserving.
- Firstcollection23AllWISEfiles(including3reused),1,154,368rows,565332491sourceB,640110742candidateB,42255196projectionworkspaceB. Copiesactualperfilereceiptsintoallwise-remote-evidence/receipts/,summary.json andworker-progress.json; theseareactualmeasuredsums, notprovider364GBmetadata. AllWISEtable nowshowsmeasuredpartialsource/detail. Collector snapshotsreadconcurrentlyarenotinstantaneousglobaljobstate, buteveryreceiptimmutableverified.
- ReporteraddedremotePSCglobalindexprogress/workspace,SBDBownedmeasurementandVSXfieldaudit hooks. WhenSBDBfinalmeasurementarrives, tablewillshowseparatefullcategorydetailbytes andID/name/routingcomponentbytes,fullservingstillunknown.
- LatestlocalPSC20/92files102,890,000rows. Gaia82/3386files42,245,853rows. Remotehostfree248468758528B. PSCglobalindexbuildingbeyond2committedfiles, originaltrialremainscomponentmeasurementnotfullglobaltotal.
- Collectoractualexecutionpassed; scriptscompileandgitdiffcheckpass. All52entryexhaustivecatalog/artifactscope remainsINCOMPLETE. No completionhandoff.

## 2026-09-10 07:10 UTC — resumed after local workers stopped; VSX storage launched
- User explicitlysaidkeepgoing. RemoteAllWISEandPSCglobalindex survivedovernightandremainactive. LocaloldPIDs20206/22956/46367weregone, logsendedwithouttracebacks; reasonnotestablished. Sourcecheckpointsintact148Gaiafiles75,809,396rows and43PSCfiles221,213,500rows. Do NOT assumeoldlocalPIDsactive.
- Restartedcheckpointedlocalworkers: GaiaPID1418 sameargs(manifestgaia-source-md5.txt,existingGaiaSource_000000-003111.csv.gz); PSCPID1419 samefull92manifest/schema/existingsource; PSCsyncPID1420 sameSSHtarget/root. AllconfirmedliveandGaiacompletedadditionalnewfiles150/3386,76,833,629rows. PSC43filesstilllastcheckpointat04:38elapsed,revalidatingprefix/download/convert, noerrors. workersjsonupdated. NewworkspaceobserverPID1935 watchesGaia1418, outputworkspace-observed-peak-resume-20260910.json (oldpeakpreserved). MemoryRSS~253MBGaia+252MBPSC+54MBobserver+21MBsync under768MiBlimit. Localfree215059861504B.
- ReadonlycollectorreportedAllWISE1325files77,226,568rows,37,617,732,062sourceB,43,289,345,625candidateB,2,869,763,805projectionB. RemotePSCglobalindex25committedfiles128,612,500rows,21,621,198,848bytesatcheckpoint. Remotehostfree219854602240B,load0.91/1.18/1.26. Nonearefulltotal.
- SBDBtypedstorage COMPLETEDSUCCESS:1,567,287rows/all80fields,3,165,057aliases; detail308114014B,index134393856logical/134397952allocatedB,SHA dcbbe2a1094f9188759496871cd850949bdca45c03a83e7088d2b8be248df2cc. Sum442507870B isdetail+ID/name/routingCOMPONENT ONLY. Allfieldssecondpass/globalintegrity/accounting/8offlinesamplespassed.1467.904s. receiptlocal sbdb-owned-evidence/measurement.json. Unitactive/exited, doNOTreportstillrunning. nativeAPI,crosscatalogIDs,ephemeris/rendering,latencybudgets/atomicsnapshotsemanticsstilloutstanding. Localrunmetadataupdatedcompletedcomponent.
- VSXfieldaudit COMPLETEDSUCCESS10304679rows21fields,zero numericexceptions,SHAcorrect,935.709s. BlankPeriod5,470,670;Epoch8,657,742. Receiptvsx-source/fields.receipt.json. DoNOTreportfieldauditstillrunning. Unitsactive/exitedsuccess.
- Added scripts/measure_vsx_owned_storage.py forcomplete21fieldParquet strings/nulls preservingprecision/flagsandCDSReadMe, sourceSHA/count+allfieldsecondpass,globalSQLiteOID/name/routing+angularRTree withsourceJ2000coordinates(no depth). Perrowgroupindextransactions/checkpoints,duplicatesrollbacknotmerge; unsupportedcoordsremainstoredwithoutangularentry. Includesfullglobalintegrity+Rtreecheck+3offlinelocatorchecks. Bibliography joins,crosscatalogidentities,angulartiles,nativeAPI/budgetsremainunbuilt.
- Newtestvsx_owned_storage_test.py PASSEDunknowncoordinatesvsrealzero,flags2constant/nonexistentand3possibleduplicatepreserved,duplicateIDtransactionrollbackandfullfieldroundtrip. No appDBmutation.
- FullVSXstorage workerstarted AppsServer unit skychart-storage-1271-vsx-storage.service; sameownworkdir /tmp/skychart-storage-1271-psc-index, inputdata/storage-exhaustive-1271/vsx-field-audit outputdata/storage-exhaustive-1271/vsx-owned-storage. Logvsx-storage.log. CPU25%RAM512Mswap0Nice19IOWeight1,freefloor100GiB. Estimate1–3hpublishedbeforerun. Cmd venv/bin/python -u scripts/measure_vsx_owned_storage.py INPUT OUTPUT. ConfirmedrunningCONVERTING_AND_VERIFYING_FULL_SOURCE. Localmetadata vsx-storage-remote.json.
- Collector extendedtofetchvsx-owned-evidence/{progress,measurement}.jsonwhenpresent. ReporterincludesVSXrun,measurementandresumedlocalworkspacepeak. DocaddedprecisecompletedSBDBcomponentandVSXauditfacts. gitdiffcheckpass. Entire52catalog/artifactscopeINCOMPLETE; no completionhandoff.

## 2026-09-10 07:18 UTC — AllWISE lookup trial measured
- All5mainmeasurementsactive: localGaia1418/PSC1419,remoteAllWISEfull/PSCglobalindex/VSXstorage. LocalPSCsync1420+workspaceobserver1935active. PSC44/92files226358000rows afterresume, sync44waitingpsc_abs. Gaia151files77,341,972rows lastreport. AllWISE1349files78,361,782rows,38,160,835,373sourceB/43,904,120,208candidateB/2,909,759,210projectionB. Hostfree218967257088B.
- Implemented scripts/build_allwise_lookup.py: realglobalSQLitecntrPK+designationindex+file/rowgroup/offsetlocators, exact64bit IDs, keepsnonuniquedesignations, perpartitionatomiccommit/checkpoints/resume/checksums. No identitymerge orangularartifactclaim. --max-files and --wait-for-files supported for staged/fullruns. Fullcountgate747634026 andintegritychecks.
- tests/allwise_lookup_test.py passed ID>2^53,nonunique names,locators,andduplicateIDtransactionrollback. Onecompletepartition trial ranApps Server unit skychart-storage-1271-allwise-index-trial.service CPU25%RAM512Mswap0Nice19IOWeight1; FINISHEDSUCCESS.51536rows,4349952logical/4354048allocatedB,SHA9af16e6a423a0466de82bb9f2a0a926a2819bcdb842ca1366a2fc0f3c2043ce2,3.08865s. Receiptcopiedallwise-remote-evidence/lookup-trial.receipt.json, reporterdisplaysseparately. ActualSQLiteatremoteallwise-full/lookup.sqlite. No fullAllWISESQLiteindexjob launched!
- Lineartrialextrapolation~63GBglobalID/nameSQLite(notfullmeasurement), whichplusremainingPSCindex~57GB+remainingAllWISEprojections~24GB+VSX~2GBwouldreduce219GBfreebelow100GiBguard beforejournalworkspace. Do notsilentlytreatself-imposedguardasusercap orclaimallformatsimpossible. Needcompactownedlookupalternative beforefullindexrun; userwasinformedthisevaluationwhilefullsourcemeasurementcontinues.
- Concrete alternative to investigate next: sortedpacked exactCNTR(uint64)+32bitrowlocator globalIDmap (12B/row~9GBuncompressed beforeheaders,NOTmeasured). Fileid14bits (12288files),rowgroup5bits (eachsourcefile<=131072rows),offset12bits canfit31bits ifallvalidated. Keepkeysfull64bit, rejectduplicateIDs, externalmergeboundedfanin64 anddurableruns/checkpoints; binarysearchglobalmappingtoownedParquet. Alias/designation index separate; investigateexactsourceformat beforeanylosslesscoordinate-stringpacking. Bothrequiredglobalindicesmustactuallybebuilt/measured; no partitionsumshortcut. Retained13colprojectionsprovideinputs. Thisisideafornextengineering,notimplementedormeasured.
- MainfullAllWISEpipelinecontinuescandidateall298fieldmeasurement; source/detailtempsrecycledonlyafterreceipts. All52catalog+artifactscopeINCOMPLETE, no completionhandoff. gitdiffcheckpass.

## 2026-09-10 07:26 UTC — compact AllWISE ID trial verified
- Five mainjobs remainactive (localGaia1418/PSC1419; remoteAllWISEfull/PSCindex/VSXstorage), pluslocalPSCsync1420/observer1935. AllWISE latest1383files80,087,751rows,38,987,030,532sourceB/44,844,441,501candidateB/2,970,733,000projectionB. Fulltotalsstillunknown.
- Added scripts/packed_catalog_id_lookup.py: version1SCID001 header16B (magic8,uint64count),records12B (uint64sourceID,uint32locator). Locatorfileid14bits,rowgroup5bits,offset12bits (31usedbits), allrangesvalidated; no truncation/lossyJSnumbers. Streaming sortedwrite, boundedfan-in1..64externalmerge, exactbinaryseekmembership, strictduplicate/sort/count/version/truncationchecks. Writes.partialandonlyreplacesvalidoldoutputoncomplete; mergesdon'toverwriteinputs. tests/packed_catalog_id_lookup_test.py PASSEDfull64bitrangeincluding0/>2^53/2^64-1,absentlookup,locatorbounds,duplicatefailurepreservesoldoutput,truncatefailure.
- Added trial_allwise_packed_lookup.py, ranAppsServerunit skychart-storage-1271-allwise-packed-trial CPU25%RAM512Mswap0Nice19IOWeight1; COMPLETEDSUCCESS. Ownedtrialroot data/storage-exhaustive-1271/allwise-packed-trial. Uses4completeverifiedprojections0,1091,8274,8438; sortsperfile andmergesactualruns. All237433locatorscheckedagainstoriginalprojection arrays. IDonlymergedindex2,849,212logical/2,850,816allocatedB,SHAf1b1e0ffca2144d1287f2ff380301dd7dd6a6431010ea9793434c7d4035aa323. FirstpartitionIDrun618448B. Trial8.098s;24warmlookupmax0.092503ms. Inputs/runsandmergedids.scidretained. Copiedreceiptallwise-remote-evidence/packed-trial.receipt.json;reporterhookanddocadded.
- DO NOT compareID-only2.85MBcomponentaslikereplacementforSQLiteID+designation; designationindexstillseparate/unmeasuredincompactformat. Full747mIDmap nominal9GBbyformat formula, NOT measuredfulltotal. Fullvolumeexternalmergeyetunbuilt. No fullpackedbuilderjob started thisturn.
- Next concrete work: resumablefullpackedIDbuilderusingallretainedAllWISEprojectionsasarrive, reuse4trialrunsratherthanredosorts. Pinrelease+per-fileprojectionSHA; perfilesortedrunreceipts; waitforunavailablecompleteinputs. Onceall12288runsready, mergefanin64inpasseswithdurablegroupreceipts/stage manifests, recycleonlyownconsumedrunsAFTERverifiedoutputreceipt. Keepallsourceprojectioninputsforotherartifacts. About9GBfinaland18GBmergeworkspace fromformat/countformula seemsfitcurrentheadroomafterPSCgrowth, butmustmeasureactualfull. Handleinterruptedmerge/resumewithoutrebuildalreadyconsumedruns: stage0manifestonceallrunsready, thenresumehighestcompletedstage; skipgroupswithvalidoutputreceipt beforecheckingalreadyrecycledinputs. Needdiskguardduringlargewrite/merge (helpercurrentlyhasnoguardcallback; addperiodiccallbackevery65536records). Fullglobalcount/uniqueID/SHA+sampledofflineroutinggate; aliases/angular/nativeflowstillpending. Thisisdesignfornextstep,notimplementation.
- All52catalog/artifactscopeINCOMPLETE; no completionhandoff. Testscompile/gitdiffcheckpassed. Currentcompacttrialcompleted, doNOTreporttrialasrunning.

## 2026-09-10T07:35:32.941009+00:00 — full compact AllWISE ID build started

INCOMPLETE. No completion handoff. Local Gaia PID1418, PSC1419, sync1420, workspace1935 verified running. Gaia162/3386 files 83,226,806 rows; PSC47/92 files241,791,500 rows. AllWISE collected1411/12288 files81,490,725 rows. PSC global index26 committed files133,757,000 rows22,488,358,912 logical bytes. VSX still converting/verifying full source.

New scripts/build_allwise_packed_full.py and extended packed_catalog_id_lookup.py copied to Apps Server. Durable unit skychart-storage-1271-allwise-packed-full.service running; output data/storage-exhaustive-1271/allwise-packed-full under existing remote investigation root. Verified CPUQuotaPerSecUSec250ms, MemoryMax536870912, MemorySwapMax0, current134684672; progress42 runs1,980,717 rows. Source and trial roots allwise-full/allwise-packed-trial; pinned row manifest allwise-manifests/allwise-parquet-row-counts.csv. Log allwise-packed-full.log. Full sequential sorted runs, 64-way staged merges; no input cleanup until complete next-stage manifest durable. Reuses four completed trial sorts and verifies locators. Collector now copies packed full progress/workspace/measurement.

Prelaunch estimates published in commentary/checklist: final format ID bytes8,971,608,328 (not measured), merge workspace~18GB; source dependency70–100h provisional and additional full merge time unknown. Existing available disk218GB before launch and memory58.7GB after. No shared DB writes or spending. Focused packed/resume tests2 passed; git diff --check passed. Need continue full sources/artifacts and remaining registry acquisitions. Report generator refreshed. No full serving total established.

## 2026-09-10T07:41:14.945284+00:00 — eROSITA full source acquisition

All prior local/remote workers verified running; no completion. Added scripts/download_catalog_ranges.py (8MiB sequential HTTP ranges, validator-pinned HEAD and If-Range, per-chunk SHA/fsync/checkpoints, resume verifies all old chunks and truncates ONLY own uncommitted tail, 2MiB/s throttle, 100GiB live headroom guard). Tests/catalog_range_resume_test.py:2 passed (resume preserves completed chunks, corruption and ignored ranges rejected). No automatic retries; if network error exits, rerun same command after inspecting log and provider validator.
Local PID8614 runs full eROSITA main source download, command in data/storage-exhaustive-1271/erosita-main-source.worker.json (metadata beside root to preserve OWNER convention). Log erosita-main-source.log; root erosita-main-source; final source.bin/receipt.json; incomplete chunks.json/progress.json. Official eRASS3_Main_v1.3.fits Content-Length2139595200 ETag7f87a1c0-65229832a7b00 LastModified2026-05-19. 13 chunks109051904B verified after53s, network16.886s excluding throttle, RSS39476KiB. Total download lower bound17min, then full FITS audit pending. Read and saved official data model access-followup/erosita-main-v1.3-model.html plus receipt. Do not equate published1975540 selected DET_LIKE>6 count with whole FITS rows; retain all file rows and scientific fields.
Next: on completed source receipt, run audit_fits_source.py source.bin RECEIPT_SHA fits-audit.json in safe bounded resource context; then measure full-field normalized/index components. No row-completeness claim until audit. Reporter hooks added for source pin/progress/receipt/audit and compact AllWISE full artifacts. PSC table now uses global index progress rather than only old trial. Latest Gaia164 files84348863 rows. report refreshed, git diff check passed. Full catalog/serving totals remain incomplete.

## 2026-09-10T07:46:30.243497+00:00 — OpenNGC full records/name component measured

All existing workers remain running (local Gaia1418 PSC1419 sync1420 observer1935 eROSITA8614; remote AllWISEfull/packedfull, PSCindex, VSXstorage). eROSITA90 chunks754974720B verified; no receipt/full FITS audit yet. AllWISE1442 files82938603rows; packed full978 runs59955296rows. PSC49files252080500rows; global index27files23359533056logicalB. Full totals INCOMPLETE.
Added scripts/measure_openngc_owned_storage.py and tests/openngc_owned_storage_test.py (1passed: all fields, blank vs zero, Unicode/delimited text, nonexistent/duplicate flags, offline routing, repeat receipt verification). Copied script+prior acquired openngc source dir to Apps Server ownroot. Unit skychart-storage-1271-openngc-storage.service COMPLETED SUCCESS (SubStateexited), quartercore512MiBswap0, runtime6.295s. Do not report this unit as running. Remote output openngc-owned-storage/measurement.json collected locallyopenngc-owned-evidence/measurement.json; collector/reporter hooks added.
Full13969records32fields detail957791logical958464allocatedB SHA719758889905eb1be9f03001bdf115dbd491c843f793451a141e07f72e63418f; exactName/routing SQLite270336B SHA3e3d79b22db210366cea895cd1183196575081d9e637d9753cb28745c2f89ee6. Total1228127logicalB for these components only. All fields second-pass verified and ALL13969offline hydrations verified, indexintegritypassed. Alias/crossmatch/angular/render/native integration/budgets stillpending. Strings preserve exact source values/blank precision and pinned guide inmetadata. No physical coordinates invented.
Table/checklist updated, report stdout variable collision found during readback and fixed (component variable no longer shadows Gaia measured). Report rerun and git diff --check passed. Next continue pending artifact measurements and on eROSITA fullsourcecompletion run bounded FITS audit. No completion handoff.

## 2026-09-10T07:53:27.644598+00:00 — Quaia authoritative alternate export running

All prior local/remote jobs verified running. Current full serving/source totals INCOMPLETE. Found official IRSA Quaia overview https://irsa.ipac.caltech.edu/data/Quaia/overview.html links DOI10.26131/IRSA640 and Zenodo10403370. TAP metadata tablequaia fullcount1295502,24fields (18science+6archiveaux x,y,z,spt_ind,htm20,cntr). Docs+metadata+count saved quaia-irsa-source; do not infer physical distance from archive auxiliary fields.
Submitted ONE official async SELECT * FROM quaia FORMATvotable MAXREC2000000 PHASERUN; saved job.json/request+job-response.xml. URL https://irsa.ipac.caltech.edu/TAP/async/21597276. COMPLETE reached before download started. Do NOT resubmit. scripts/finish_quaia_irsa_export.py only resumes existingjob, waitsphasecomplete, streams2MiB/s tofull-source.partial thenrenames full-source.xml, uses existing audit_votable_source.py for everyrow/field/querystatus/overflow, compares all24 names/types topinnedcolumns.csv, recheckspostcount1295502. Final receipt.json onlyafteraudits. No sourcebyteequivalencewithoriginalFITS asserted.
Local worker PID11827 command/startedtime inquaia-irsa-source/worker.json; logworker.log; progress.json. Completed export headerContentLength1060370592B (metadataonly), at2MiB/s floor8.43minutesplusnetwork/audit. Endpointdoesnotexpose stablebyte-rangevalidator; iftransferfailsrestartsameworker,recycleonlyuncommittedownpartialfile,reusesamejob. Do not call HTTPresultwhilejobEXECUTING acompletedfile (HEADwhileEXECUTING49MB wasgrowing output, neveradmitted). PublishedwholeexportestimateafterCOMPLETED. Networkthroughputmaybelowerthanceiling.
Reporter hooks sourcejob/progress/receipt andcatalogtablefullIRSAexportafteraudit; retainsoriginaldistributionequivalencepending. Checklistupdated. ExistingVOTableauditregression1passed, newworkerpycompilepassed, reportrefreshed/gitdiffcheckpassed. NextinspectQuaiaworkerand eROSITA8614 (last1543503872B/2139595200), onsourcecompletionrunfullFITSaudit. Other source/servingartifactsremainpending.

## 2026-09-10T07:58:38.747897+00:00 — eROSITA bytes complete; VSX detail verified

Local eROSITA download8614 COMPLETED; do not report as still downloading. Full source2139595200logical2139602944allocatedB,256chunks SHA4fe0a40f8d6cbd03ff51c5e8b5f665d7adfd04391ab4df99a6caa36053184059. Receipt source_bytes_only, rowsnull untilFITS audit. Transferseconds296.150934 excludingthrottle/finalaudit. Local sourceerosita-main-source/source.bin. Detached scp PID13564 copies source.bin THENreceipt.json to AppsServer existingroot/data/storage-exhaustive-1271/erosita-main-source, cap-l40000Kbit/s (min7.13min). Command/start inlocalerosita-main-source/remote-transfer.json; logremote-transfer.log. Need checkprocess finished andremotesize/receipt beforeaudit. No auditunitstarted yet.
Prepared remote audit_fits_source.py in scripts/. Installed fitsio1.2.8+numpy2.5.3 ONLY existing isolated investigationvenv using venv/bin/python pip.pyz install; verifiedimports. No pipmoduleinvenv,useexistingroot/pip.pyz. When transfercomplete,start isolated systemdunit skychart-storage-1271-erosita-source-audit CPUQuota25%MemoryMax512Mswap0User/Group1000Nice19IOWeight1RemainAfterExityes, runvenvpython scripts/audit_fits_source.py data/storage-exhaustive-1271/erosita-main-source/source.bin 4fe0a40f8d6cbd03ff51c5e8b5f665d7adfd04391ab4df99a6caa36053184059 data/storage-exhaustive-1271/erosita-main-source/fits-audit.json. ExistingfocusedFITSaudittest1passed. Collectcompletefits-audit.json locallysamefolder/reporthookalreadyexists; collectorremotehookyetneedsadding.
VSX conversion/fullsecondpassdone:detail.receipt.json10304679rows21fields306674578logical306679808allocatedB SHAbff7bb2647642c62c02e1e8470efef53f9c481b5f318c405f500eab27efbc4ca. Globalindexstillrunning (last723/2516rowgroups). Collector nowcopiesdetailreceiptandreportvariablesrowupdated. Oldfieldauditpendingstatusfixedwhenexistingauditreceiptpresent. No fullservingclaim. AllWISEfull/index,PSCfull/index,Gaia,Quaiadownloadcontinue. Appsfree214GB before2.14GBtransfer; applicationDBuntouched. Report/checklistrefreshed gitdiffcheckpassed. Fullcatalog/servingtotalsINCOMPLETE.

## 2026-09-10T08:06:03.150567+00:00 — OpenNGC evidence/angular measured; eROSITA audit started

New scripts/measure_openngc_evidence_index.py, tests/openngc_evidence_index_test.py2passed:sexagesimalrange/poles/RAwrap,missingvszero,negativezeroDec,centralstarrelationshipnotparentalias,crossreffieldprovenance. CompleteAppsServerunit skychart-storage-1271-openngc-evidence.service EXITEDSUCCESS; outputopenngc-evidence-index/measurement.json collected localopenngc-owned-evidence/evidence-index.json. 13969records,13962angular,7missingcoordinatesretained,52925distinctnameevidence+141centralstarrelationships;53074originaloccurrencesverifiedinclduplicates;all13962RTreeboundsencloseexactsourceastrometry. Bytes5009408logical5013504allocated SHA9353b96e102d941e918245e7b5a53e3eace247f2e31322e5114927ff67ded222 runtime12.882s quartercore. Nativequerynormalization/API/crosscatalogidentity/rendering/budgetsremainpending. SharedartifactrecordedONCEinledger,aliases+angularreferencethatartifactratherthandoublecounting.
eROSITA transfer13564 COMPLETED. VerifiedAppsServer source.bin2139595200B andreceipt.json491Bcopiedlast. Startedunit skychart-storage-1271-erosita-source-audit.service (quartercore512MiBswap0User/Group1000Nice19IOWeight1RemainAfterExityes). Command audit_fits_source.py sameargspathsandSHAaspreviousnotes; logerosita-source-audit.log; finalerosita-main-source/fits-audit.json. Collectorhookaddedtosamepathlocally. NoFITSreceiptseenatstart; stillincomplete. ExistingSPIDERS107MBfullFITSaudit5.5996s isonlypriorreference, not eROSITA runtime/fullrowproof.
Quaiadownloadcomplete, worker11827 nowAUDITING_ALL_ROWS_AND_FIELDS (source1.060GBXML). No finalreceipt yet; checkworkerlog. Gaia175files90129085rows; AllWISE1491files85358233rows; allmainjobscontinue. OpenNGCcomponentunitisDONE, notstillrunning. Report/checklist/ledgerupdated, gitdiffcheckpassed. Exhaustivesource/servingtotalsINCOMPLETE; nohandoff.

## 2026-09-10T08:14:31.544712+00:00 — both audits passed; Quaia storage prepared / LS10 download

eROSITA sourceauditunit EXITEDSUCCESS:1975540rows250fields,57.9179s, sourceSHAunchanged. Receiptcollectederosita-main-source/fits-audit.json andreporttableupdated. Quaiaworker11827 FINISHEDSUCCESS:1295502rows24fieldsQUERY_STATUSOK,before/aftercountmatch,schemaall24match. FullIRSAXML1060370592logical1060376576allocatedB SHA035c3d8b82fe14a8671d9727b0b6048cc0599eed313ce16de724bb53c2c53cf4. Do not report either audit stillrunning. OriginalFITSbyteequivalence/selectionproductsremainpending.
Added scripts/measure_quaia_owned_storage.py: all24 sourceVOTablefields typed longint64,doublef64,charstring incl6archiveaux; missingblanknull,NaNpreserved; no distanceinference. Two-passallfieldverification; deterministic4096rgzstd3Parquet; perrowgrouptransactional resumableSQLiteID/counterpart/RAdec/RTree/routing. CounterpartIDs nonunique, do not merge. Integrity/globalcount/allangularbounds plusfirstrowofflinelocatorpergroup; budgets/native/rendering/identitiesremainpending. tests/quaia_owned_storage_test.py1passed (IDs>2^53 andmaxint64,nullNaN,realzero,sharedcounterpart,duplicateIDrollback). ScriptcopiedAppsexistingroot/scripts andremotecompilepassed.
Quaiaverifiedsource+receipttransferringlocalPID16929 via scp-l40000Kbit/s toAppsroot/data/storage-exhaustive-1271/quaia-irsa-source. Metadata localquaia-irsa-source/remote-transfer.json logremote-transfer.log. Last2m50s778MBof1.060GB remote, sourcebefore receipt. Waittransferdonebeforestartstorageunit! NoQuaiastorageunitstartedyet. Planunit skychart-storage-1271-quaia-storage withusualquartercore512MiBswap0User/Group1000Nice19IOWeight1RemainAfterExit, command venvpython scripts/measure_quaia_owned_storage.py data/storage-exhaustive-1271/quaia-irsa-source data/storage-exhaustive-1271/quaia-owned-storage; logquaia-storage.log. Publishedestimate15–45min provisionalunderquartercore; notcompletionlimit. Collector/reporthooksadded quaia-owned-evidence/progress/detail.receipt/measurement.
Started completeeROSITALS10counterpartsource downloadlocalPID16984 viaexistingdownload_catalog_ranges.py, rooterosita-ls10-source, logerosita-ls10-source.log, metadataerosita-ls10-source.worker.json. OfficialURL eRASSc3_Main_LS10_Public_27Jul2026.fits.gz; HEAD1053710795B ETag3ece59cb-65797161de4c0 LM2026-07-27;2MiB/s lowerbound8.37min. Sourcefieldmodelpinnedaccess-followup/erosita-ls10-model.html+receipt. Must gzipCRC/decompressandfullFITSauditafterbytecompletion; no objectcountadditionforcrossmatchproduct. Reporter sourcepin/progress/bytehooksadded. Appsfree209GBaftertransfergrowth; noDBmutation/newspend. Gaia179files92234411rows. Allglobalmajorjobscontinue. Report/checklistupdated, gitdiffcheckpassed. Exhaustive totalsINCOMPLETE; nohandoff.

## 2026-09-10T08:20:31.446622+00:00 — Quaia storage running / compressed FITS audit prepared

Quaiatransfer16929 FINISHED. Remote full-source.xml1060370592B plusreceipt12907B present. Started unit skychart-storage-1271-quaia-storage.service, usualquartercore512MiBswap0User/Group1000Nice19IOWeight1RemainAfterExit, sourcequaia-irsa-source outputquaia-owned-storage; logquaia-storage.log. Confirmedrunning, phaseCONVERTING_AND_VERIFYING_ALL_FIELDS;MemoryCurrent94220288(cgroupreading,notRSS),MemoryMax536870912CPUQuota250ms. No detail/finalmeasurementyet.
Added scripts/audit_compressed_fits_source.py: receipt-boundsourceSHAverification, gzipstreamCRC/lengthvalidation, 1MiBchunks withliveheadroomguard, distinctcompressed/decompressedreceipts, atomicrenameonlyafterEOF/full2880Bblocks, thenexistingfullboundedFITSaudit. tests/compressed_fits_source_test.py1passed (truncatedgzip/incompleteblocksneverreplacevalidoutput). ScriptcopiedtoAppsexistingroot/scripts; owninputdirerosita-ls10-sourceprepared. OnceLS10rangejob16984complete, copy source.bin THEN receipt.json there atcap-l40000; aftercopycomplete launchskychart-storage-1271-erosita-ls10-audit withusualquartercore512MiBlimits, command audit_compressed_fits_source.py data/storage-exhaustive-1271/erosita-ls10-source data/storage-exhaustive-1271/erosita-ls10-audit. No LS10 transfer/auditstartedatthisnote. LastLS10progress116chunks973078528B/1053710795. Decompressedbytesandfullaudittimeremainunknown, notassumedgzipISIZE.
Collector/reporthooksLS10decompressionandFITSauditadded, sharedsourcebytescompressedvsuncompressedseparate. CurrentPSC53files272658500rows; VSXindex1877/2516rowgroups. Gaia182files93806174rows. Allmajorjobscontinue. Report/checklistupdatedgitdiffcheckpassed; fullcatalog/servingtotalsINCOMPLETE.

## 2026-09-10T08:28:48.141983+00:00 — LS10 gzip/FITS audit and full NVSS audit running

LS10download16984 FINISHED:1053710795logical1053716480allocatedB,126ranges,SHA32a7e85d6f5e309b153789f72e605c73c96fb8f920bfabc95211b5723f0b8a68,transfer_seconds184.4353excludes throttle/finalhash. Startedtransfer19967, nowFINISHED: Appsownroot/erosita-ls10-source/source.bin1053710795B,receipt512B. Started unit skychart-storage-1271-erosita-ls10-audit.service usualquartercore512MiBswap0; commandaudit_compressed_fits_source.py data/storage-exhaustive-1271/erosita-ls10-source data/storage-exhaustive-1271/erosita-ls10-audit; logerosita-ls10-audit.log. Waitdecompressed.receipt.json thenfits-audit.json; collectorhooksalreadyexist. Compressedsourcefullbytesonly, rowcount/gzipfullvalidationpending.
Found/fixedCDSschema parserignoredsinglebyte declarations (e.g NVSSbyte53DE-sign,93/100limitflags). audit_cds_fixed_width.py regexnowoptionalend; enddefaultsstart. Tests/cds_fixed_width_audit_test.py2passed inclsign/limits regression. NVSSschema29fieldsnow, VSXschema21unchangedbecauseactualVSXReadMeexplicit41-41 etc; no existingVSXfieldloss. ActualsourceNVSSvariablelengths first10000fixture105/126/134/153/158; notfullaudit.
Added scripts/audit_nvss_source.py full1,773,484-row gzip fieldaudit: pinnedsourceSHA/row/decompressedbytecounts, fullgzipCRC, all29fields inclsign/limits, trailingblankpadonlyforinspection, numericvalidity/blanks/flagdistributions. Rawsourceunchanged; no identitymerge/placementinferred. Copiedprioracquired77,687,389Bgzip+receipt+ReadMe toAppsownroot/nvss-field-audit/{source.gz,source.receipt.json,ReadMe}; hashesfromprioracquisition. Alsocopiedupdatedsharedparser(doesnotchangealreadyimportedVSXworker). Unit skychart-storage-1271-nvss-field-audit.service STARTEDusualquartercore128MiBswap0; command scripts/audit_nvss_source.py data/storage-exhaustive-1271/nvss-field-audit; lognvss-field-audit.log; expectedfields.receipt.json; collectornvss-owned-evidence/fields.receipt.json/reporthookready. Numericexceptionsmustnotbeclaimedverified. WholeNVSSfieldauditpending.
Allothermainjobsrunning; Appsfree209.9GBbeforeLS10transfer/newaudit. Report/checklistupdatedgitdiffcheckpassed; Exhaustivecatalog/servingtotalsINCOMPLETE.

Startup correction: initial NVSS and LS10 auditunits FAILED BEFOREprocessing with missing acquire_catalog_source_manifest module. Copied scripts/acquire_catalog_source_manifest.py toAppsownscripts; executed actual import ofbothauditors successfully, then systemctlrestart ONLY these2investigationunits. Oldtracebacksremainlogs; inspectcurrentSubState/Result andprogress ratherthanoldtail alone. No sourcechanges. This supersedes pre-status claim theywerealreadyrunning.

## 2026-09-10T08:36:30.042149+00:00 — LS10/NVSS audits passed; PSC transport resumed

LS10 gzip/FITSauditEXITEDSUCCESS. Exactactualreceipt1591243rows189fields (an initialcommentary incorrectlysaid1883850/239; immediatelycorrectedafterreadingreceipt; NEVERrepeatwrongcounts). Decompressed1785499200logical1785503744allocatedB SHAb4eed06143c9cf7d0a2ae0a7e672b3853a9cd801b3442377ba15444d5347cac5. Decomp51.946793s, FITSaudit51.845917s. Sourcecompressed1053710795B remainsseparate; noaddeduniqueobjectpopulation/crossmatchglobalservingclaim.
NVSS fullauditPASSED1773484rows29fields,zeroexceptions,277851724uncompressedsourceB,162.406585s. Signcounts-687325/+1086159; upperlimitsmajor1489153/minor1732910. Lengths158:1035004,153:728153,105:7999,134:938,126:1366,104:24. Receiptlocalnvss-owned-evidence/fields.receipt.json. Allsourcefieldsverifiedbutnormalizeddetail/ID/sky/globalartifactsstillpending.
PSCsync1420 hadEXITED on scpSSH255 Connectionclosed copyingreceiptpsc_acc.gz.json.incoming after54publishedfiles. Sourceimportscontinue. Fixed scripts/sync_psc_investigation_inputs.py withboundedtransport-onlyretry(4attemptsbackoff5/10/20s), retriesonly255, othercommandsfailimmediately; publicationconditionalincoming-existsmvELSEfinal-existsallowsdisconnectaftercompletedrename safely, receiptalwayslast. Testpsc_transport_retry_test.py1passed. Restartedlocal syncPID22249 (metadataremote-sync-worker.json), verifiedrunning/transferringinterruptedpsc_acc.gz afterrecheckingpublishedreceipts. Priorpartialincomingcanbereplaced; noacceptedreceiptchanges.
Quaiadetailverified1295502rows24fields190836606logical190840832allocatedB SHA079a2fe04f18a1aa6e35099152101abd2e67af1b42f4aae0e9d1f04781efb52b. Globalindexlast317groups built,finalchecksongoing; nofinalmeasurementreceiptseenincollector yet. Checknextturnfinalunitstateandreceipt, notjustprogressINDEXING. VSXmainindexcontinues. Gaia190files98054337rows atlatestreport, AllWISE1563files89081569rows. Appsfree203.98GBavailablememory58.52GB. Report/checklistupdated gitdiffcheckpassed. ExhaustivetotalsINCOMPLETE.

Final Quaia update supersedes preceding in-progress note: unitEXITEDSUCCESS, fullmeasurementcollectedquaia-owned-evidence/measurement.json. Index210702336logical210706432allocatedB SHAba0723fe9e530e14158b7071f2769281968515f5f6adba09ae16512455ae4d58; typeddata190836606B; combined401538942logicalB onlythesecomponents. All1295502rows/angularrows,317offlinehydrationsamples,globalintegrity/count/allangularboundsverified. Runtime1135.282573s18.92min. Remainingselectionfunctions/nativeAPIbudgets/identities/rendering: fullservingnull. Do not report Quaiaworker stillactive. Collector/report/checklistupdated; globalmajorGaia/PSC/AllWISE/PSCindex/VSXindex continue.

## 2026-09-10T08:43:45.250972+00:00 — full NVSS storage/index started

New scripts/measure_nvss_owned_storage.py usesexistingnvss-field-audit/{source.gz,ReadMe,fields.receipt.json}, validatesfull1773484rows29fieldcontract+source/schemaSHAs, storesoriginaltext/nullprecision/flagswithsourceguideinParquet4096rgzstd3. Secondpassallfieldcomparison. PerrowgroupresumableSQLiteordinal/name/RAdec/RTree/routing; duplicate namespreservednotmerged, ordinalscopedsourceversion. PositionJ2000equinoxcentroidobsepoch1995+/-2; documentedseconds60normalized, zero/negativeDecsignspreserved, missing/invalidangularrowsretainedwithoutdepth. Finalglobalcount/integrity/allangularbounds+1source-namelocator/group anddistinctnamecount. NativeAPI/identities/tiles/budgetsremainpending. Tests/nvss_owned_storage_test.py2passed (trailingblanks,radioflags/zero,coordinatewrap,unknown/invalidpositions,repeatednames,suffixpreservation).
Copiedscript toAppsownscripts; verifiedactualimportbeforelaunch. Unit skychart-storage-1271-nvss-storage.service RUNNING, outputdata/storage-exhaustive-1271/nvss-owned-storage; lognvss-storage.log. Usualquartercore512MiBswap0User/Group1000Nice19IOWeight1RemainAfterExityes. ConfirmedMemoryCurrent136675328MemoryMax536870912CPUQuota250ms; phaseCONVERTING_AND_VERIFYING_ALL_FIELDS. Publishedprovisional10–35minestimate, notdeadline/measuredsize. Collector/reporthookslocalnvss-owned-evidence/{progress,detail.receipt,measurement}.json added; report/checklistupdated,gitdiffcheckpassed.
Gaia1418/PSC1419/localobserver1935/PSCsync22249running. Syncprogresspsc_acd.gz at55files (resumedpastpreviousfailure). MainremoteVSXindex/PSCindex/AllWISEsource+packedIDs continue; no VSXfinalreceiptcollectedyet. AllWISE1591files90645865rows latestcollected. Fullcatalogandnative-servingtotalsINCOMPLETE, nohandoff.

VSX finalupdate supersedes preceding no-receipt note: finalmeasurementarrivedduringreport. UnitEXITEDSUCCESS. Full10304679rows/angularrows; data306674578B,index1841586176logical/allocatedB SHA0f594715aace509f5e1f3f067c0e6dfa0d34bb88cd9836a9fcdc31be48ce18c1,combined2148260754logicalB fordata+lookupcomponents. Globalcounts/SQLiteRTreeintegrity/3offlinehydrationsamplespass,allsourcefieldsverifiedearlier. Runtime5442.980341s90.72minutes. Remainingbibliography/identities/angularrendering/nativeAPIbudgets fullservingnull. ReporterVSXindexhookanddocupdated; doNOTcallVSXworkerrunninginfuture. NVSSstorageandlargeGaia/PSC/AllWISE/indexjobscontinue.


## 2026-09-10T09:01:29.860868+00:00 — FITS data measurement and eROSITA memory recovery

New scripts/measure_fits_table_storage.py preserves all supported numeric/text fields, fixed arrays, endian precision, NaNs, numeric null sentinels and full FITS headers. Batches1024, zstd3, full second-pass verification, source/audit hashes and durable per-HDU receipts. Unsupported types explicitly fail; non-table HDUs stay in source and are excluded from table sum. New tests/fits_table_storage_test.py covers int64 IDs, arrays69 and multidimensional arrays, NaNs, null sentinels and drift rejection. Focused FITS/NVSS/CDS tests:5passed. Remote script and dependencies installed/import-verified in existing isolated venv only.
SPIDERS unit skychart-storage-1271-spiders-storage.service EXITEDSUCCESS. Source/audit under spiders-source/spiders-dr20.fits and spiders-dr20-fits-audit.json. Output spiders-owned-storage, collected spiders-owned-evidence/measurement.json. All263310rows49fields verified, detail34369481logical34369536allocatedB SHA679dfbdb009d01e8943b17ce47290dcb5bc01bffe1cd8c3c09e304b3dd04ecfe,16.805s. Primary HDU non-table7169-byte image content remains in original source; do not count detail as complete serving.
eROSITA main unit skychart-storage-1271-erosita-main-storage.service failed OOM at512MiB after1967104/1975540rows. No completed receipt accepted. Available host RAM58735259648B/free disk199503323136B justified raising ONLY this isolated unit MemoryMax=2G via systemctl set-property and restarting. Quartercore/swap0/lowIO unchanged. LaststatusRUNNING MemoryCurrent970416128B. Command scripts/measure_fits_table_storage.py data/storage-exhaustive-1271/erosita-main-source/source.bin data/storage-exhaustive-1271/erosita-main-source/fits-audit.json data/storage-exhaustive-1271/erosita-main-owned-storage. Logerosita-main-storage.log. Collector hooks erosita-main-owned-evidence/progress+measurement. Failed partial is investigation-owned and rewritten; no previously verified table redone. Provisional10–30min estimate, not deadline.
LS10 full FITS audit complete1591243rows189fields; source remote erosita-ls10-audit/source.fits + fits-audit.json. Can run generic converter after main verified; no LS10 storage job yet. NVSS stillRUNNING atINDEXING433/433groups, final integrity/receipt pending. PSC fullindex, AllWISEsource and packedindex allRUNNING. Report refreshed:Gaia202/3386files104473452rows;AllWISE1641/12288files93179885rows. Full source and serving totals remain null/incomplete. Need measure global routing/crossmatches/rendering and finish all52registry entries; no completion handoff.


## 2026-09-10T09:05:19.038506+00:00 — NVSS completed; LS10 conversion started

NVSS completed full source-field data and name/angular/routing lookup measurement:
1,773,484 rows, all with valid angular positions, and 1,773,484 distinct names.
Detail is 71,494,180 bytes; global lookup is 265,703,424 logical bytes
(265,707,520 allocated), for 337,197,604 logical bytes combined. Full-field
verification, global integrity/angular checks and 433 offline retrieval samples
passed. Runtime was 1,222.60 seconds. Cross-catalog identity evidence, native
rendering and API budgets remain unmeasured; this is not a full serving total.

Full eROSITA LS10 counterpart table conversion has started from its already
verified local source on Apps Server: 1,591,243 rows, 189 fields. This measures
an association product, not additional unique physical objects. The isolated
worker has a 2 GiB memory cap, quarter-core CPU limit, low I/O priority and no
swap. Provisional runtime is 10–30 minutes. An initial unsupported Boolean field
stopped conversion before acceptance; Boolean support was added and regression
verified before restart. Original decoded Boolean values are retained without
inference, alongside the source FITS headers and original source file.

NVSS unit EXITEDSUCCESS; measurement collected nvss-owned-evidence/measurement.json. DetailSHA38ca742520731392ae6b64bbbaa69a6812a062be20273b8c6c02b70e6d31b427; indexSHA7ecd87023d771d59ac7209659154898d05a6a19986edba4621acb16be18ae9e6. Do not call NVSS active. LS10 unit skychart-storage-1271-erosita-ls10-storage.service, command scripts/measure_fits_table_storage.py data/storage-exhaustive-1271/erosita-ls10-audit/source.fits data/storage-exhaustive-1271/erosita-ls10-audit/fits-audit.json data/storage-exhaustive-1271/erosita-ls10-owned-storage; logerosita-ls10-storage.log. Collector+report hooks added erosita-ls10-owned-evidence/progress+measurement. Firstattempt failed unsupported dtype bool has_Salvato18_AGN_colors; converter dtypekind b now supported, FITS regression1passed inclbool roundtrip, scriptcopied and unitrestarted. No accepted table redo. eROSITA main stillrunning at1967104rows after2GiB restart; last cgroupanon265MB vs1.67GBfilecache,RSS307348KiB,OOM0 at~3min. Check completion/failure before claiming. Full totals remain INCOMPLETE; nohandoff.


## 2026-09-10T09:11:11.438046+00:00 — eROSITA main complete; SPIDERS exact lookup started

Full eROSITA main table conversion completed: 1,975,540 rows, 250 fields,
1,429,300,866 logical bytes (1,429,307,392 allocated), SHA-256
`c36a7982d5442a91159b6743f90a51f97fb859b6f85d2d7838fe39a61136735d`.
All fields passed independent second-read verification. The successful attempt
used 433.32 seconds; this excludes the earlier failed attempt. Native serving
artifacts and total build workspace remain separate unfinished measurements.

A complete SPIDERS exact-field lookup is now building for `ero_detuid`,
`sdss_catalogid` and `sdss_id`. It preserves repeated identifiers and lossless
integer/text values with field-scoped keys and table/group/offset locations.
These are lookup entries, not assertions of object identity. Every locator is
verified, including resumed groups; final global counts and SQLite integrity
must pass before a receipt is accepted. Regression tests passed for duplicate
IDs, integer precision, resumed builds and modified source rejection. Estimated
runtime is provisionally 1–10 minutes with a quarter-core/512 MiB limit.

Main unit EXITEDSUCCESS, receipt collected erosita-main-owned-evidence/measurement.json. Do not report main conversion active. LS10 lastRUNNING. New scripts/measure_fits_exact_lookup.py + tests/fits_exact_lookup_test.py2passed, script remoteimportverified. Unit skychart-storage-1271-spiders-exact-lookup.service runs scripts/measure_fits_exact_lookup.py data/storage-exhaustive-1271/spiders-owned-storage data/storage-exhaustive-1271/spiders-exact-lookup ero_detuid sdss_catalogid sdss_id. Logspiders-exact-lookup.log. StandardUser/Group1000quartercore512MiBswap0Nice19IOWeight1RemainAfterExit. Collector/report hooks spiders-owned-evidence/exact-lookup-progress.json and exact-lookup.json. Exact values include source integer sentinels without interpreting as established IDs; null omitted, repeated IDs kept via row locator. Full global checks and every key locator verified. Can reuse for eROSITA main IAUNAME DETUID UID after first full SPIDERS validation, then LS10 IAUNAME DETUID LS10_FULLID ERO_LS10_FULLID (verify actual scalar types). Native/semantic identity evidence/angular tiles still pending. LocalGaia1418 PSC1419 sync22249 confirmedactive. Gaia206files106578663rows;AllWISE1678files95169393rows lastreceipt. FulltotalsINCOMPLETE nohandoff.

LS10 final update: unit EXITEDSUCCESS. All 1591243 rows / 189 fields verified. Detail 1016307291 logical bytes, 1016311808 allocated bytes, SHA fa9a9bc5bffde1e244beb16a9e872e75ccfb44378638c729dcd022e2401d0d50. Successful invocation 316.79 seconds. Collected erosita-ls10-owned-evidence/measurement.json. Do not report LS10 conversion still active. This is counterpart-table data, not unique objects or complete serving size. SPIDERS exact lookup remains active.


## 2026-09-10T09:14:37.137962+00:00 — SPIDERS lookup complete; eROSITA main lookup running

SPIDERS full exact lookup finished: 263,310 records, 789,930 field-scoped entries
for ero_detuid, sdss_catalogid and sdss_id. SQLite occupies 39,976,960 logical
bytes (39,981,056 allocated), SHA-256
`2b42f2135ac604be891563b223ad2a9835b85d80474c508a07c18f378b44108a`.
Every locator and global row/entry accounting passed, along with SQLite
integrity. Runtime was 87.11 seconds. Angular rendering, interpretation of
identification evidence and native API budgets remain outstanding.

The complete eROSITA main exact lookup is building for IAUNAME, DETUID and UID,
using the verified full table. Decoded types were checked as string, string and
int64 before launch. The provisional runtime estimate is 10–20 minutes based
on the completed SPIDERS run; bytes will be reported only from its own final
receipt. A 2 GiB memory cap accommodates the wide table's Parquet metadata,
with quarter-core CPU and low I/O priority. Apps Server had 58,755,772,416 bytes
of available RAM and 197,682,147,328 bytes of free disk before launch.

SPIDERS exact lookup unit EXITEDSUCCESS, no longer active. eROSITA main unit skychart-storage-1271-erosita-main-exact-lookup.service runs scripts/measure_fits_exact_lookup.py data/storage-exhaustive-1271/erosita-main-owned-storage data/storage-exhaustive-1271/erosita-main-exact-lookup IAUNAME DETUID UID. Logerosita-main-exact-lookup.log. User/Group1000 quartercore2GiBswap0Nice19IOWeight1RemainAfterExit. Collector/report hooks erosita-main-owned-evidence/exact-lookup-progress.json and exact-lookup.json. LS10 source fields checked scalar strings IAUNAME DETUID LS10_FULLID ERO_LS10_FULLID, ready for same tool after main; not started yet. Gaia1418/PSC1419/sync22249 confirmedactive,62PSCfiles synced waitingpsc_baf.gz. Other remotePSCindex/AllWISEsource/AllWISEpackedindex confirmedRUNNING. Full source/data/index/rendering totals remain INCOMPLETE; nohandoff.


## 2026-09-10T09:18:46.443077+00:00 — Hipparcos full field audit complete

The complete Hipparcos I/239 hip_main.dat field audit passed: 118,218 records,
78 documented fields, zero numeric-format exceptions. Source size remains
53,316,318 bytes and its existing checksum is unchanged. The documented record
width is 450 bytes; the last defined field ends at byte 449, so the audit now
explicitly verifies the one trailing byte is blank. It never truncates or edits
the original source. Regression tests reject nonblank trailing content and
undersized width settings. Full audit runtime was 23.31 seconds on the task
container. Numeric RA/Dec, parallax and proper-motion fields are blank in 263
records; those records remain included. This is the main table only, not all
Hipparcos/Tycho annexes. Converted storage, indexes and native artifacts remain
unmeasured.

Updated scripts/audit_cds_fixed_width.py optional record_width/--record-width validates trailing spaces strictly, default existing width behavior unchanged. tests/cds_fixed_width_audit_test.py3passed. Local full audit finished, receipt small-releases/hipparcos-fields-receipt.json. Source small-releases/hip_main.dat and readme access-followup/hipparcos-readme; sourceSHA58ceabb104d647160d9437ce6e513a02a036bb4ad9f8879a5a22fd52943616e0,ReadMeSHA7a7d54903d16460a76c240f07c41b019d57becfd27b5dfa2908e828f52f90c27. Reporterhook hipparcos_full_field_audit and checklistupdated. Next useful work: normalize all78fields retaining source precision/flags/units and originals; no normalized Hipparcos job started yet. Could reuse VSX/NVSS CDS conversion approach but source is plain fixedwidth450. eROSITA main exact lookup stillRUNNING,640groups656384rows verified,MemoryCurrent1455865856B. Main2GiB cap/noOOM reported. LS10 exact lookup remains queued/notstarted. Gaia209files108177226rows;AllWISE1700files96431673rows. Collector/report/diffcheck passed. ExhaustivetotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:22:47.337983+00:00 — full Hipparcos table conversion running

Full Hipparcos main-table storage is running from the existing verified source
and field audit. The converter preserves all 78 field values as original
precision text, with blank fields represented as null and original units,
flags and full CDS ReadMe retained as metadata. A second source read compares
every field before the completed table receipt is written. Original source
padding and delimiters remain in the retained source file. This measures table
data, not indexes or native rendering. Regression verification passed for
large identifiers, negative/zero/missing parallax, flags, metadata, completed
receipt reuse and modified-output rejection. Provisional runtime is 1–5 minutes
at a quarter core and 512 MiB memory cap on existing Apps Server resources.
Available RAM before launch was 58,345,197,568 bytes; free disk was
196,474,961,920 bytes. No shared database or application was changed.

New scripts/measure_cds_table_storage.py, tests/cds_table_storage_test.py1passed. Bounded4096groups zstd3 dictionaryfalse, manifest pins sourceauditSHA, source+ReadMeSHAverifiedbeforework, outputOWNER+lock, allfieldsecondpass +metadataequality, receiptatomic onlyaftervalidation; completedoutputSHAchecked onresume. Copied scriptand53MBsourceexistingdata toAppsroot/data/storage-exhaustive-1271/hipparcos-source/{hip_main.dat,hipparcos-readme,hipparcos-fields-receipt.json}. Remoteimportverified. Unit skychart-storage-1271-hipparcos-storage.service runs scripts/measure_cds_table_storage.py those3files data/storage-exhaustive-1271/hipparcos-owned-storage. UsualUser/Group1000quartercore512MiBswap0Nice19IOWeight1RemainAfterExit. Loghipparcos-storage.log. Last40960/118218rowsCONVERTING. Collector/reporterhooks hipparcos-owned-evidence/progress+measurement. eROSITA main exact lookup stillRUNNING, nofinalreceipt yet. LS10exactlookupnotstarted. Fullcatalog/servingtotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:26:46.940488+00:00 — Hipparcos data and eROSITA main lookup complete


Hipparcos main-table data measurement completed: 118,218 rows and 78 fields,
12,940,412 logical bytes (12,943,360 allocated), SHA-256
`635ee8441fdda6437918079d017f222840768ba269b4a6ea5dda4550e371cd3f`.
Every field passed second-read verification; runtime was 78.38 seconds.
Its complete exact lookup is now building for HIP, HD, BD, CoD, CPD and CCDM.
The lookup preserves field-scoped original identifiers and repeated references;
three regression tests passed, including CDS leading zeros and shared IDs.
Provisional runtime is 1–5 minutes at a quarter core and 512 MiB memory cap.

The eROSITA main exact lookup completed: 1,975,540 records, 5,926,620 entries,
279,613,440 logical bytes (279,617,536 allocated), SHA-256
`834c23cac3a2207089943e8ed8da7c16bb49d2eac6d0cbcf00921ada71b9445f`.
All locators, global counts and SQLite integrity passed; runtime was 652.99
seconds. The LS10 counterpart lookup is now building for IAUNAME, DETUID,
LS10_FULLID and ERO_LS10_FULLID with a quarter core and 2 GiB cap. A provisional
10–25 minute estimate follows from the completed main lookup; four fields and
longer string keys can change the runtime and size. No unique-identity claim
is made from these associations. Angular/rendering artifacts and native API
budgets remain separately unmeasured for both products.

Do not report Hipparcos conversion or eROSITA main lookup active. New unit skychart-storage-1271-hipparcos-exact-lookup.service runs scripts/measure_fits_exact_lookup.py data/storage-exhaustive-1271/hipparcos-owned-storage data/storage-exhaustive-1271/hipparcos-exact-lookup HIP HD BD CoD CPD CCDM. Loghipparcos-exact-lookup.log. New unit skychart-storage-1271-erosita-ls10-exact-lookup.service same tool source erosita-ls10-owned-storage output erosita-ls10-exact-lookup fields IAUNAME DETUID LS10_FULLID ERO_LS10_FULLID; logerosita-ls10-exact-lookup.log. Both usualUserGroup1000Nice19IOWeight1swap0RemainAfterExit. Generic lookup now accepts FULL_CDS_TABLE_DATA_COMPONENT_MEASURED mapped to single table slot0 (not FITSHDUclaim), preserving original text/nulls; FITS mapping unchanged. Testsfits_exact_lookup_test.py3passed. Updated remote scriptimportverified. Collector/report hooks bothproducts exact-lookup-progress.json/exact-lookup.json. Fullcatalog/source/servingtotalsINCOMPLETE; nohandoff.

Hipparcos lookup final update: completed successfully, 118,218 records and 377,781 field-scoped entries, 10,039,296 logical bytes (10,043,392 allocated), SHA-256 6239377c0ebe9c1818896d05823224c7727d47d9de163f1aad6ef6c4324f62ba. Every locator, global counts and integrity passed in 40.30 seconds. Hipparcos data plus this lookup occupy 22,979,708 logical bytes; angular/rendering and native serving remain unmeasured. Do not report the Hipparcos lookup as active. LS10 lookup remains running.


## 2026-09-10T09:31:43.755356+00:00 — 3C/3CR/4C complete data and name lookup


Complete 3C (1959), revised 3CR (1962), and 4C pinned CDS tables now have measured
data and exact-name lookups. 3C: 471 rows/27 fields, 41,786 data bytes and 28,672
lookup bytes. 3CR: 328 rows/19 fields, 35,022 data bytes and 24,576 lookup bytes.
4C: 4,844 rows/13 fields, 100,456 data bytes and 126,976 lookup bytes. Every
scientific field and exact-name locator passed verification, with global counts
and SQLite integrity checked. These are separate release records; 3C and 3CR
are overlapping catalogues and their rows are not a unique-object count.
Source 1950 coordinate epochs, radio-band fluxes, flags and notes are retained;
angular transformations, rendering and semantic identification remain pending.

Reproduce or resume with `python scripts/measure_radio_catalogs.py
 data/storage-exhaustive-1271` (one command). Original source checksums and
record-length distributions are retained; explicit short-record padding applies
only to field access and does not rewrite the acquired files. Strict width
validation remains the default for other callers. Five CDS regression tests
passed, including rejection of empty rows and implicit truncation/padding.
These three small tables were measured sequentially in the existing task
container; each component took under two seconds. No server or database change
was needed. Full serving sizes remain unknown.

New measure_radio_catalogs.py resumable driver using audit_cds_fixed_width pad_short_records=True, existing pinned acquired source+ReadMe, measure_cds_table_storage and measure_fits_exact_lookup. Outputs radio-owned-storage/{3c--3c.dat,3c--3cr.dat,4c--radio4c.dat}/{fields.receipt.json,table/measurement.json,lookup/measurement.json}. Replay rechecks hashes and reuses receipts. Reporter radio_table_measurements maps exactcomponents to3c and4c checklistentries. Audit records original lengths and padflag, rejects empty/overlong rows; normalizedreaderhonors explicitreceiptflag. Fullfield/routinghashes inreceipts. LS10exactlookup/mainlargePSC/Gaia/AllWISEjobs stillrunning, LS10last192groups197632rows. ExhaustivetotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:36:26.547870+00:00 — full 6dF table measurement running


Complete 6dF VII/259 catalogue and spectrum-metadata measurements are running
sequentially from the previously acquired gzip files: 124,647 catalogue rows
and 136,304 spectrum-metadata rows. These counts describe separate table types,
not their sum as unique objects. Compressed source SHA-256, gzip CRC and exact
expanded bytes are checked before field audit. Original scientific values,
redshift quality flags, null sentinels, epochs and documentation are retained.
Unnamed CDS delimiter fields receive stable byte-position labels while keeping
the original unnamed label in schema metadata. They are not dropped.

The driver is `python scripts/measure_6df_catalog.py data/storage-exhaustive-1271`.
It resumes from durable expansion, field, data and exact-lookup receipts.
Six focused regression checks passed, including truncated gzip preserving a
valid prior expansion and unnamed delimiter preservation. Provisional runtime
is 2–10 minutes on existing Apps Server at a quarter core, 512 MiB RAM, low I/O
priority and zero swap. Before launch, available RAM was 55,130,202,112 bytes
and free disk was 195,381,133,312 bytes. Spectrum image files are not included
in this table measurement. Angular rendering, spectrum-file acquisition scope,
identity interpretation and native serving remain separate unfinished work.

New scripts/measure_6df_catalog.py, tests/sixdf_measurement_test.py2passed plusCDS4passed. Remote copied current audit_cds_fixed_width.py and measure_cds_table_storage.py and6dfdriver; importverified. Unit skychart-storage-1271-6df-storage.service, command venvpython -u scripts/measure_6df_catalog.py data/storage-exhaustive-1271, standardUser/Group1000quartercore512MiBswap0Nice19IOWeight1RemainAfterExit. Log6df-storage.log. Sources copied additional-sources/6df--{6dfgs,spectra}.dat.{source,json} and extra-catalog-docs/6df. Outputs6df-owned-storage/{6dfgs.dat,spectra.dat}/{source.dat,expanded.receipt.json,fields.receipt.json,table/measurement.json,lookup/measurement.json}. Collector local6df-owned-evidence sameartifactlayout; reporter sixdf_table_measurements mapsbothwholecomponents to6df. Driver lookupfields 6dFGS/Target forcatalogue; SpecID/Target/6dFGS forspectra. No3rdpartyimageacquisitionyet. LS10lookup/largejobscontinue. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:40:31.439341+00:00 — 6dF and BASS components complete


6dF's two table measurements completed. Catalogue: 124,647 rows, 27 fields,
4,664,457 data bytes plus 8,196,096 exact-lookup bytes. Spectrum metadata:
136,304 rows, 24 fields (including documented separators), 3,787,992 data bytes
plus 12,746,752 lookup bytes. All fields, 249,294 catalogue lookup entries and
408,912 spectrum lookup entries passed verification. Combined component size
is 29,395,297 logical bytes. Spectrum image files and native serving artifacts
are not included. The catalogue conversion/lookup took 32.00/17.81 seconds;
spectrum metadata conversion/lookup took 30.40/32.81 seconds, excluding audits
and expansion. The 6dF worker is finished.

BASS DR2's pinned J/ApJS/261/2 tables also completed sequentially on the task
container. Table 8: 1,449 observing rows/28 fields, 131,854 data bytes and
49,152 lookup bytes. Table 9: 858 property rows/14 fields, 89,991 data bytes and
61,440 lookup bytes. Table 11: 47 new-redshift rows/8 fields, 56,558 data bytes
and 16,384 lookup bytes. Total measured components: 405,379 logical bytes.
Source schemas, component flags, redshift fields and original precision are
retained. All fields, exact lookup locations, global counts and SQLite integrity
passed. These table counts are not a sum of distinct objects. Native angular
rendering, identification interpretation and API budgets remain unmeasured.

Reproduce/resume BASS with `python scripts/measure_bass_catalog.py data/storage-exhaustive-1271`.
Each component took less than two seconds. Replayed BASS and radio drivers
successfully reused completed receipts while rechecking source/data checksums.
No shared database, application deployment or new infrastructure was involved.

Do not report6dfworkeractive. All6dfreceiptscollected6df-owned-evidence. BASSnewdriver scripts/measure_bass_catalog.py uses shared measure_tables frommeasure_radio_catalogs.py; outputbass-owned-storage/{bass-dr2--table8.dat,bass-dr2--table9.dat,bass-dr2--table11.dat}/{fields.receipt.json,table/measurement.json,lookup/measurement.json}. Reporterbass_table_measurements mapsall3completeparts toregistrybass-dr2. BASSlookupfields ID/m_ID fortable8; ID/m_ID/CName fortable9; ID/CName fortable11; duplicatespreserved, componentfactskeptfulldetail. Originalsourcesadditional-sources,ReadMeextra-catalog-docs/bass-dr2 unchanged. Replaylogs radio-resume-check.jsonl+bass-resume-check.jsonl. LS10stillRUNNING960groups984064rows; Gaia218files113105671rows;AllWISE1769files100444127rows. Collector/report/diffcheckpassed. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:44:15.445597+00:00 — Local Volume seven-table components complete


All seven pinned Local Volume J/AJ/145/101 science/reference tables completed
full-field and exact-lookup measurement. Table 1: 869 rows/27 fields,
101,851 data bytes plus 40,960 lookup bytes. Table 2: 869 rows/23 fields,
99,364 plus 40,960 bytes. Table 3 (photometry): 3,190 rows/6 fields,
80,691 plus 188,416 bytes. Table 4 (velocities): 761 rows/4 fields,
64,803 plus 53,248 bytes. Table 5 (HI widths): 610 rows/4 fields,
62,528 plus 49,152 bytes. Table 6 (distance moduli): 783 rows/5 fields,
65,473 plus 57,344 bytes. Bibliography: 346 rows/4 fields,
63,168 plus 40,960 bytes. Total data is 537,878 bytes; lookup is 471,040 bytes;
combined measured components are 1,008,918 bytes.

All original field precision, bands, limits, measurement methods, references,
source epochs and flags are preserved. All field values, exact lookup locations,
global counts and SQLite integrity passed. Repeated measurements remain separate;
the two 869-row property tables do not imply 1,738 galaxies. The prior exact-name
and distance comparison with the NEARGALCAT 869-row export remains the overlap
evidence, rather than counting a new physical population. Cross-table association
artifacts, native angular/physical rendering and API budgets remain unmeasured.

Reproduce/resume with `python scripts/measure_local_volume_catalog.py data/storage-exhaustive-1271`.
The seven small tables ran sequentially on the existing task container, and the
completed run was replayed to verify checksum checks and receipt reuse. No new
acquisition, production import or infrastructure spending was involved.

New scripts/measure_local_volume_catalog.py calls shared measure_tables; outputs local-volume-owned-storage/local-volume--{table1.dat..table6.dat,refs.dat}/{fields.receipt.json,table/measurement.json,lookup/measurement.json}. Inputsadditional-sources,ReadMeextra-catalog-docs/local-volume. Lookup Name fields, plus source-referencefields r_mag,r_HRV,r_W50,r_DM fortables3..6, Ref/BibCode forbibliography. Reporterlocal_volume_table_measurements mapsall7 tolocal-volume. Replaylogs local-volume-measurement.jsonl and local-volume-resume-check.jsonl. LS10stillRUNNING1152groups1180672rows. MainGaia/PSC/AllWISE/indexjobscontinue. AllWISE1777files100919064rows lastcollector. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:47:56.641411+00:00 — Fornax eight-table data/index components complete


All eight acquired Fornax VII/180 tables now have measured full data and exact
lookup components. p2tbl2: 340 rows/20 fields, 57,520 data bytes and 24,576 index
bytes. p2tbl3: 2,338 rows/16 fields, 75,548 and 118,784 bytes. notes: 122 rows/3
fields, 41,114 and 24,576 bytes. The five p3 tables have 24 fields each:
p3tbl2 52 rows, 52,298/16,384 bytes; p3tbl3 79 rows, 53,181/16,384;
p3tbl4 120 rows, 53,681/16,384; p3tbl5 162 rows, 54,032/16,384;
p3tbl6 375 rows, 57,892/24,576. Total data: 445,266 bytes; exact lookup:
258,048 bytes; combined measured components: 703,314 bytes.

Original background and uncertain membership flags, B1950 astrometry, names,
notes, velocities and measurement precision are retained. Tables remain distinct;
background records are not treated as cluster members, and FCC numbers in
different contexts do not cause identity merges. The five p3 tables explicitly
use the shared `p3tbl*.dat` schema documented by CDS. Compressed sources are
checksum/CRC/expanded-size verified, with separate expansion receipts. All source
fields and lookup locations, global counts and SQLite integrity passed.

Reproduce/resume with `python scripts/measure_fornax_catalog.py data/storage-exhaustive-1271`.
The small tables ran sequentially in the task container and replay successfully
reused completed receipts. Seven focused CDS/gzip regression tests passed.
Angular transformations, rendering, cross-table association artifacts and native
API validation remain unmeasured; no full serving total is implied.

New scripts/measure_fornax_catalog.py. Shared measure_radio_catalogs.measure_tables supports optionalexplicit schema_tables mapping and gzip magic detection; imports existing6dfexpand helper, verifies compressed/expandedSHA and preserves expansionreceipt. No changes to originalsourcefiles. Outputsfornax-owned-storage/fornax-cluster--{p2tbl2.dat,p2tbl3.dat,notes.dat,p3tbl2.dat..p3tbl6.dat}/{fields.receipt.json,expanded.receipt.json whencompressed,table/measurement.json,lookup/measurement.json}. LookupFCC forp2tbl2; FCC/bgGal forbackground+notes;N/Name forp3tables. Reporterfornax_table_measurements mapsall8 tofornax-cluster. Logsfornax-measurement.jsonl andfornax-resume-check.jsonl. LS10stillRUNNINGlastcheck; nofinalreceipt. GlobalGaia/PSC/AllWISE/indexjobscontinue. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:51:12.641477+00:00 — Abell five structured table components complete


All five structured Abell VII/110A tables completed full data and exact lookup
measurement. Table 3: 2,712 rows/21 fields, 136,026 data bytes and 77,824 index
bytes. Table 4: 1,364 rows/44 fields, 131,450 and 49,152 bytes. Table 5:
1,174 rows/42 fields, 124,477 and 65,536 bytes. Table 6: 274 rows/41 fields,
89,995 and 24,576 bytes. Notes: 3,316 rows/4 fields, 97,773 and 204,800 bytes.
Total data is 579,721 bytes; lookup is 421,888 bytes; combined measured
components are 1,001,609 bytes. The acquired docu.txt remains a separate raw
source artifact and is not counted as structured table data.

All scientific field text, B1950 astrometry, classifications, uncertainty flags,
redshift information and notes are retained. All fields, lookup locations,
global counts and SQLite integrity passed. The S supplementary catalogue,
overlap-zone rows and prefix-dependent note references remain distinct; no
sum of those rows is presented as unique clusters. Native angular/physical
rendering, cross-table relationship artifacts and API budgets remain unmeasured.

Reproduce/resume with `python scripts/measure_abell_catalog.py data/storage-exhaustive-1271`.
Tables ran sequentially in the existing task container. A completed replay
verified source/data checksums and receipt reuse. No shared DB or deployment
was changed. Exact per-table checksums and allocated bytes are in the ledger.

New scripts/measure_abell_catalog.py usesexistinggenericmeasure_tables. Outputs abell-owned-storage/abell--{table3.dat,table4.dat,table5.dat,table6.dat,notes.dat}/{fields.receipt.json,table/measurement.json,lookup/measurement.json}. LookupACO fortables3/4,ACOS/S table5,ABELL table6,ACO/Prefix/Field notes. Reporter abell_table_measurements mapsall5 toabell;docu.txt retainedseparately inadditional-sources. Logsabell-measurement.jsonl andabell-resume-check.jsonl. LS10stillRUNNINGlast1472groups1508352rows, nearingfinalvalidation; do notcountcompletedwithoutreceipt. PSCfullindex/AllWISEsource/packedindex confirmedRUNNING. AllWISE1795files101953760rows. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:55:12.852034+00:00 — LS10 lookup and ten 2MRS table components complete


LS10 exact lookup completed: 1,591,243 counterpart-table records, 6,364,972
field-scoped entries, 393,670,656 logical bytes (393,674,752 allocated), SHA-256
`497461e7e09ad77b7fd0e1d71b6b7fb29c2e19cc55177c5f1902859b61de7929`.
All locators, global counts and SQLite integrity passed. Runtime was 1,520.59
seconds (25.34 minutes), slightly above the provisional 10–25 minute range.
Together with table data, these components occupy 1,409,977,947 logical bytes.
This excludes native rendering and interpreted identity/association artifacts.
The LS10 worker is finished and must not be reported as active.

All ten pinned 2MRS J/ApJS/199/26 tables completed. Table 3: 44,599 rows/29
fields, 3,221,515 data bytes plus 1,609,728 index bytes. Table 4: 590 reference
rows/2 fields, 54,450/40,960 bytes. Table 6: 4,291 rows/7 fields,
143,597/167,936 bytes. Table 7: 14 rows/7 fields, 48,472/16,384 bytes.
Table 8: 324 rows/2 fields, 51,001/28,672 bytes. Table 9: 74 rows/8 fields,
51,161/16,384 bytes. Table 10: 87 rows/1 field, 45,747/16,384 bytes.
Table 11: 155 rows/1 field, 46,323/24,576 bytes. Table 12: 334 rows/11 fields,
58,564/28,672 bytes. Table 13: 4,857 rows/5 fields, 110,476/188,416 bytes.
Total data: 3,831,306 bytes; exact lookup: 2,138,112 bytes; combined: 5,969,418
bytes. Removal reasons, compromised-photometry lists, alternative redshifts,
reference codes and original units/precision remain available as separate
source tables. Their rows are not summed as independent objects or confused
with complete 2MASS XSC coverage.

All fields, exact lookup locations, global counts and integrity passed.
Reproduce/resume with `python scripts/measure_2mrs_catalog.py data/storage-exhaustive-1271`.
The ten tables ran sequentially on existing task resources, and replay verified
checksum checks and receipt reuse. Native rendering, cross-table relationships
and API budgets remain unmeasured. Full catalogue/serving totals remain incomplete.

LS10unitEXITEDSUCCESS, finalreceiptcollectederosita-ls10-owned-evidence/exact-lookup.json. Newmeasure_2mrs_catalog.py usesgenericmeasure_tables withschema table[67].dat fortables6/7. Outputs2mrs-owned-storage/2mrs--table{3,4,6,7,8,9,10,11,12,13}.dat/{expanded.receipt.json whencompressed,fields.receipt.json,table/measurement.json,lookup/measurement.json}. LookupBibcode fortable4,IDforallothers. Reportertwomrs_table_measurements mapsall10to2mrs. Replaylogs2mrs-measurement.jsonl/2mrs-resume-check.jsonl. MainlocalGaia1418PSC1419sync22249confirmedrunning;PSCsync68fileswaitingpsc_bal.gz. RemotePSCindex/AllWISEsource/packedindexconfirmedRUNNING. AllWISE1803files102363867rowslastcollector. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T09:58:35.741993+00:00 — full 2QZ/6QZ table measurement in progress
New scripts/measure_2qz_catalog.py usesexistinggenericmeasure_tables. Inputsadditional-sources/2qz--{2qz.dat,ngp_rep.dat,sgp_rep.dat,6qz_rep.dat}.{source,json},ReadMeextra-catalog-docs/2qz. Explicit sharedschema name "ngp_rep.dat sgp_rep.dat 6qz_rep.dat" forrepeatfiles. Output2qz-owned-storage/2qz--TABLE/{expanded.receipt.json,fields.receipt.json,table/measurement.json,lookup/measurement.json}. Mainlookup2QZ/intNo/intName,repeatlookup2QZ/intName; observationskeptdistinct. Runninglocal execsession78052, stdout2qz-measurement.jsonl; lastVERIFYING_ALL_FIELDS28672/49425mainrows. Do not rerun concurrently. Reporter twoqz_table_measurements hookmapsall4onlywhencomplete. Needpollsession, verifyfullreceipts and replayaftercomplete, thenupdatefinalsizes. AllWISE1809files102673902rows, Gaia/PSC1418/1419stillrunning; no LS10job active anymore. FulltotalsINCOMPLETE nohandoff.


## 2026-09-10T09:59:18.741605+00:00 — 2QZ/6QZ components complete


The full acquired 2QZ/6QZ table set passed data and exact-lookup measurement.
Main catalogue: 49,425 rows/48 fields, 3,371,123 data bytes and 4,767,744 index
bytes. NGP repeat table: 926 rows/22 fields, 69,272 and 86,016 bytes. SGP
repeat table: 1,047 rows/22 fields, 73,567 and 90,112 bytes. 6QZ repeat table:
87 rows/22 fields, 42,061 and 24,576 bytes. Total data: 3,556,023 bytes;
lookup: 4,968,448 bytes; combined measured components: 8,524,471 bytes.

All original field values, classifications, redshift quality flags, observation
dates, signal-to-noise values and J2000/B1950 coordinates are retained. Repeat
observations remain separate records; source classifications are not replaced
by an assertion that every row is a confirmed quasar. Full-field comparison,
exact lookup locations, global counts and SQLite integrity passed. The shared
repeat-table schema is explicitly pinned to its documented CDS section.

Reproduce/resume with `python scripts/measure_2qz_catalog.py data/storage-exhaustive-1271`.
The sequential run completed on existing task resources, and replay verified
source/data checksums and receipt reuse. Original spectra, angular rendering,
interpreted associations and native API budgets remain separate unmeasured
artifacts; these components do not establish the full serving total.

Supersedes precedinginprogressnote: exec78052EXIT0, replay44597EXIT0. Do not report2qzmeasurementactive. Logs2qz-measurement.jsonl and2qz-resume-check.jsonl, fullreceiptsunder2qz-owned-storage;twoqz_table_measurements reporterhook active. MainGaia/PSC/AllWISE/indexjobscontinue. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T10:02:38.145817+00:00 — Markarian seven structured components complete


All seven structured Markarian VII/172 tables completed data and exact lookup
measurement. Table 7: 1,469 rows/33 fields, 118,222 data bytes and 53,248 index
bytes. Notes: 39 rows/5 fields, 64,522/16,384 bytes. Table 6: 48 rows/13 fields,
68,377/16,384 bytes. Table 8: 818 rows/2 fields, 68,738/61,440 bytes. Table 9:
1,549 rows/2 fields, 70,458/90,112 bytes. Table 10: 1,517 rows/2 fields,
67,861/94,208 bytes. References: 195 rows/2 fields, 65,585/16,384 bytes.
Total data: 523,763 bytes; exact lookup: 348,160 bytes; combined: 871,923 bytes.
The acquired descrip.doc remains separately retained as source documentation.

Original 1950 coordinates, redshift conventions, secondary-object notes,
classifications, aliases and reference numbers are retained. All fields,
lookup locations, global counts and SQLite integrity passed. An independent
read-only query of table 10's exact-name index found 61 duplicated abbreviated
name groups containing 127 records; every match remains separately addressable.
No nearest-name identity merge is performed. Reference rows and aliases are
not summed as additional physical objects.

Reproduce/resume with `python scripts/measure_markarian_catalog.py data/storage-exhaustive-1271`.
The small tables ran sequentially on existing task resources. Replay verified
source/data checksums and completed receipt reuse. Angular rendering,
cross-table relationship artifacts, identity assembly and native API budgets
remain unmeasured; the full serving total remains unknown.

Newmeasure_markarian_catalog.py outputmarkarian-owned-storage/markarian--{table7.dat,notes.dat,table6.dat,table8.dat,table9.dat,table10.dat,refs.dat}/{fields.receipt.json,table/measurement.json,lookup/measurement.json}. Reporter markarian_table_measurements mapsall7 toregistrymarkarian. LookupMrk fortable7+notes;Name/Nref table6;Mrk/Name tables8..10;Nref refs. Logsmarkarian-measurement.jsonl andmarkarian-resume-check.jsonl. Duplicatechecktable10SQLite mode=ro groupfieldName HAVINGcount>1 =>61groups127records,documentedabove. GlobalGaia/PSC/AllWISE/indexjobscontinue;AllWISE1820files103268577rowslastcollector. FulltotalsINCOMPLETE nohandoff.


## 2026-09-10T10:07:52.243762+00:00 — clusters and sixteen nebula tables complete


The pinned Harris globular-cluster release VII/202 completed: 147 rows and 42
fields, 49,830 data bytes plus 24,576 lookup bytes, totaling 74,406 logical
bytes. Full values, distance assumptions and source coordinates are retained;
sources.txt remains separate source documentation. This is the historical
147-record release, not a claim of current comprehensive cluster coverage.

All sixteen V/84 planetary-nebula tables completed full data and exact lookup
measurement. Total data is 1,228,868 bytes; lookup is 704,512 bytes; combined
measured components are 1,933,380 bytes. Per-table rows/fields/data/index bytes:

- nebulae--main.dat: 1143 / 15 / 107458 / 49152.

- nebulae--diam.dat: 1143 / 9 / 72426 / 49152.

- nebulae--dist.dat: 296 / 7 / 62802 / 24576.

- nebulae--dista.dat: 3017 / 7 / 76052 / 106496.

- nebulae--hbeta.dat: 991 / 4 / 68744 / 45056.

- nebulae--intens.dat: 1046 / 22 / 89726 / 49152.

- nebulae--iue.dat: 1715 / 8 / 82935 / 65536.

- nebulae--iras.dat: 774 / 21 / 96464 / 40960.

- nebulae--nir.dat: 365 / 12 / 68308 / 28672.

- nebulae--radio.dat: 689 / 8 / 67822 / 36864.

- nebulae--vel.dat: 614 / 14 / 72189 / 32768.

- nebulae--cstar.dat: 692 / 17 / 80121 / 36864.

- nebulae--notes.dat: 703 / 2 / 65104 / 36864.

- nebulae--pospn.dat: 347 / 12 / 70413 / 28672.

- nebulae--notpn.dat: 330 / 11 / 70437 / 32768.

- nebulae--refs.dat: 872 / 2 / 77867 / 40960.

Every field, lookup location, global count and SQLite integrity check passed.
Candidate and rejected-object lists, repeated measurements, central stars and
references remain separate records. Original bands, limits, distance models
and B1950/J2000 coordinates are preserved without inference. IUE's documented
77-byte width includes one trailing blank after field byte 76. NIR row 102 has
one verified extra trailing space beyond byte 105; an explicit 106-byte setting
preserves that layout evidence. All original source bytes remain unchanged.

Reproduce with `python scripts/measure_cluster_catalog.py data/storage-exhaustive-1271`
and `python scripts/measure_nebula_catalog.py data/storage-exhaustive-1271`.
Sequential runs and completed replays passed on existing task resources.
Five focused CDS regression tests passed. Spectral/image products, interpreted
associations, native rendering and API budgets remain separately unmeasured.

Newmeasure_cluster_catalog.py andmeasure_nebula_catalog.py; outputsclusters-owned-storage/clusters--catalog andnebulae-owned-storage/nebulae--TABLE usualfields/table/lookupreceipts. Nebula names main,diam,dist,dista,hbeta,intens,iue,iras,nir,radio,vel,cstar,notes,pospn,notpn,refs. Sharedschema dist.dat dista.dat; genericmeasure_tables nowoptionalrecord_widths passedtoaudit. Widthoverrideiue77/nir106 explicitvalidatedblank. First2failedattempts rejectedonlyunverifiednexttable; completedreceiptsreused. Replaysfinished79848EXIT0. LookupsPNGformain/science,Name/PK candidates+notpn,Ref bibliography;clustersID/Name. Reporterspecialist_table_measurements keyedclusters/nebulae requiresall1/16 tablesbeforeupdates. Docsretained separately. All70additionalacquisitions now appear to have67structuredtables+3documents; independentlyreconcilethisnextturn (notyetverifiedrollup). GlobalGaia/PSC/AllWISE/indexjobscontinue. FulltotalsINCOMPLETE; nohandoff.


## 2026-09-10T10:12:14.138010+00:00 — 70-file batch reconciled


The initial additional-source acquisition batch is now independently reconciled:
70 pinned files, exactly 67 structured tables and 3 retained documents. Every
local acquired file was freshly SHA-256 checked, and each structured-table
receipt was matched to its pinned source, expansion (where applicable), schema,
row count, field count and completed lookup verification. Source files total
97,573,157 bytes; normalized structured data totals 91,154,951 bytes; built
indexes total 296,288,256 bytes. These are separate storage categories for this
batch only. They do not establish a full catalog-universe or serving total.

The complete per-file table is in `docs/catalog-additional-batch-measurements.md`.
Reproduce with `python scripts/reconcile_additional_measurements.py data/storage-exhaustive-1271 data/catalog-registry/additional-source-acquisition-manifest.json data/storage-exhaustive-1271/additional-components-reconciliation.json`.
The reconciliation regression rejects mismatched source hashes, row/field
counts and unverified lookup receipts. Remote data/index byte checks remain
those documented in their completed receipts; this reconciliation freshly
rehashes local acquired source files, not every remote artifact again.

Other registry releases, native angular/physical rendering, relationship and
identity artifacts, extra source products, build workspace, retained backups
and native API budgets remain unfinished. Large full-source and index workers
continue. No overall completion or universal coverage claim is made.

Newreconcile_additional_measurements.py, tests/additional_measurement_reconciliation_test.py1passed. JSONadditional-components-reconciliation.json includes70entries and perfile source/data/indexSHA, pinnedmanifestSHA4832c860e8a1972769f415da4cdb489146da5595a8ef5988723c8065d59de4ca; full_catalog_universe_bytes/full_serving_bytes null. Reporteroptionaladditional_batch_component_reconciliation hook. Docs67structuredrows+3docs tablepublishedcatalog-additional-batch-measurements.md. Structuresactualmaps6dfremoteevidence/NVSSremoteevidence; otherfamilieslocalverifiedownedtables. Documentsabell--docu.txt/markarian--descrip.doc/clusters--sources.txt. Nextworkremainingregistryentries/acquisitiongaps/nativeartifacts; do not remeasurecompleted67tables. FulltotalsINCOMPLETE nohandoff.


## 2026-09-10T10:16:46.038496+00:00 — full exoplanet VOTable measurement prepared
New scripts/measure_votable_storage.py typed scalar TABLEDATA converter, zstd3/256rowsgroup, allfieldmetadata/sourceSHA retained, source/hashverified, fullsecondpass compare inclNaNs, metadataequality, OWNER+lock+pinnedmanifest, rejectunsupportednumericarrays/types. SharedQuaia records helper now supports int->int32 inadditionlong/double/char; priorQuaia contract unchanged. tests/votable_storage_test.py +quaia_owned_storage_test.py2passed. Fullsource alreadyaudited6360rows703fields (323double,310char,70int), exoplanets-source/retry-full/pscomppars.vot+receipt.json. Copyingsource169497514B toAppsroot/data/storage-exhaustive-1271/exoplanets-full-source via scp-l40000, execsession66672:mustwaitsuccessbeforestartunit. Scriptscopiedremote. Plannedunit skychart-storage-1271-exoplanets-storage.service quartercore512MiBswap0UserGroup1000Nice19IOWeight1RemainAfterExit, command scripts/measure_votable_storage.py data/storage-exhaustive-1271/exoplanets-full-source/pscomppars.vot data/storage-exhaustive-1271/exoplanets-full-source/receipt.json data/storage-exhaustive-1271/exoplanets-owned-storage. Logexoplanets-storage.log. Publishedestimate5–15minprovisional. HostRAMavailable58792108032B diskfree191954558976B. Collector/reporthooks exoplanets-owned-evidence/progress+measurement alreadyadded. No workerstartedatthisnote. Needremoteimportverify thenstart. FulltotalsINCOMPLETE nohandoff.

Exoplanet startup update: copy66672EXIT0; remoteimportverified; unit skychart-storage-1271-exoplanets-storage.service successfullystarted withplannedcommand. LastRUNNINGCONVERTING_ALL_FIELDS512/6360rows,MemoryCurrent64077824B. SourceSHAcheckedbyworker. Do notcallcompletewithoutfinalreceipt.


## 2026-09-10T10:21:19.338818+00:00 — exoplanet full table complete; lookup started


Full PSCompPars table measurement completed: 6,360 rows and all 703 fields,
14,906,263 logical bytes (14,909,440 allocated), SHA-256
`84f4d113c3ec198f45b1e6837706691e6b05eb697cbca5f206e4c6f89e4141f5`.
All scalar values and field metadata passed the independent second source
read. Runtime was 179.88 seconds, below the provisional 5–15 minute estimate.
The retained original VOTable remains separately measured source storage.

A full nine-field exact lookup is now building for systemid, sy_name, objectid,
pl_name, hostname, hd_name, hip_name, tic_id and gaia_dr3_id. Shared hosts and
catalogue references retain every matching planet record; these lookup entries
are not established object identities. The generic lookup accepts completed
scalar VOTable receipts, preserving the same source/hash verification gates.
Five focused lookup/VOTable regression tests passed. Provisional lookup runtime
is under three minutes at a quarter core and 512 MiB on existing Apps Server.
Angular routing, interpreted host/planet relationships, native rendering and
API budgets remain separate unfinished measurements.

ExoplanetsstorageunitEXITEDSUCCESS, collected exoplanets-owned-evidence/measurement.json. No longerconversionactive. Newunit skychart-storage-1271-exoplanets-exact-lookup.service runs scripts/measure_fits_exact_lookup.py data/storage-exhaustive-1271/exoplanets-owned-storage data/storage-exhaustive-1271/exoplanets-exact-lookup systemid sy_name objectid pl_name hostname hd_name hip_name tic_id gaia_dr3_id. StandardUserGroup1000quartercore512MiBswap0Nice19IOWeight1RemainAfterExit; logexoplanets-exact-lookup.log. Remoteimportverified. Collector/reporthooks exoplanets-owned-evidence/exact-lookup-progress.json andexact-lookup.json. Tablemapper accepts FULL_SCALAR_VOTABLE_DATA_COMPONENT_MEASURED single slot0, testsparametrizedCDS/VOTable. Testsfits_exact_lookup4+votable_storage1passed. Needpolllookup andcollectfinalreceipt. AllWISE1872files105986336rowslastcollector. FulltotalsINCOMPLETE; nohandoff.

Exoplanet lookup final update: completed successfully with all 6,360 rows and 46,057 non-null field-scoped entries, 1,708,032 logical/allocated bytes, SHA-256 01c542145b3ea1bce333055b851314f996b3ad97a574ceafe529d9185937b3db. Every locator, global count and SQLite integrity check passed in 6.19 seconds. Table data plus this lookup total 16,614,295 logical bytes. Do not report either exoplanet worker as active. Native angular/rendering, relationship and API artifacts remain unmeasured.


## 2026-09-10T10:26:35.043738+00:00 — ATNF lossless records and ID lookup complete


ATNF release 2.8.1 now has measured lossless source-record storage and exact
PSRJ/PSRB lookup for all 4,393 records. Record data occupies 1,096,007 logical
bytes (1,097,728 allocated), SHA-256
`1406d71932a9d6604ffd61b55549eb9dbc76884a4f441a23109be386a1e2523b`.
The index occupies 258,048 logical/allocated bytes, SHA-256
`8ef11da6844aa3750c4248cf3666387442ff8dc613a9171474afcb3e00b1e959`.
Combined measured components: 1,354,055 bytes.

Reconstructing the complete original database from stored header and records
produced its exact SHA-256
`29e423e5878d8b97e397425b6a1fe1529396a7b25909e3c1d56924641db6c63b`.
All 162 distinct source field tags, uncertainty digits, reference strings,
comments and record separators remain unchanged. Every record and index
location was verified, with global counts and SQLite integrity checked.
This is lossless source-record storage, not completed typed scientific
hydration, distance interpretation or native API integration. The original
package retains ancillary documentation and source files separately.

Reproduce/resume with `python scripts/measure_atnf_storage.py data/storage-exhaustive-1271`.
The run completed in 1.86 seconds on existing task resources. A regression
checks exact bytes, aliases, unterminated records and duplicate PSRJ rejection;
completed replay checks stored artifact hashes. Angular rendering, identities
and native serving budgets remain separate unfinished measurements.

Newmeasure_atnf_storage.py andtests/atnf_storage_test.py1passed. Reads exact regular tar memberpsrcat_tar/psrcat.db viaextractfile only (noarchivepath extraction), sourcecontentreceipt10,432,859B checked; recordblocks storebinary source_record plusPSRJ/PSRB, metadataheader, zstd3rg256. Globalfieldoccurrenceinventory162tags. Outputatnf-owned-storage/{manifest.json,records.parquet,lookup.sqlite,measurement.json}; reporteratnf_owned_measurement maps topulsars withtypedhydrationpending status. Completedlocal31874EXIT0; replayatnf-resume-check.json. NoATNFworkerstillactive. AllmainGaia/PSC/AllWISE/indexjobscontinue. FulltotalsINCOMPLETE nohandoff.


## 2026-09-10T10:30:16.153081+00:00 — full Virgo VCC data and lookup complete


The full pinned Virgo Cluster Catalogue J/AJ/90/1681 table completed: 2,096
rows and 13 fields, 45,592 data bytes (49,152 allocated), SHA-256
`6d991c02a5a8b5ddf6fdffb8d8aa01fc293b2718b1738b3a5b028b753f9f4ae2`.
Its 4,192 field-scoped VCC/ID lookup entries occupy 114,688 logical/allocated
bytes, SHA-256 `5cadffef2feb61220f3b899b248cfac5db15c2b5bbf130a3abcc8b330058b1a3`.
Combined measured components: 160,280 bytes. Data conversion and lookup took
1.24 and 1.10 seconds respectively on existing task resources.

All source fields and lookup locations, global counts and SQLite integrity
passed. A readback of stored membership flags found 1,275 members, 575 possible
members and 246 background objects. The original HRV=0 unknown-velocity sentinel
is preserved in 1,525 records and is not promoted to a physical measurement.
Original B1950 coordinates, names and classifications remain unchanged.
These are release classifications, not a new independent membership judgment.

Reproduce/resume with `python scripts/measure_virgo_catalog.py data/storage-exhaustive-1271`.
A completed replay passed source/data checksum checks and reused receipts.
Source gzip CRC and expanded bytes are retained in separate evidence. Native
angular transformations/rendering, relationship artifacts and API budgets remain
unmeasured, so no full serving total is implied.

Newmeasure_virgo_catalog.py, inputvirgo-source/virgo-vcc--vcc.dat.source/.json;ReadMeaccess-followup/virgo-readme-resolved. Outputvirgo-owned-storage/{source.dat,expanded.receipt.json,fields.receipt.json,table/measurement.json,lookup/measurement.json}. Aggregatedvirgo-measurement.json andvirgo-resume-check.json; reporteroptionalvirgo_owned_measurement maps tovirgo-cluster. No Virgo workeractive, completed25869/replay31403EXIT0. AllWISE1895files107229610rowslastcollector. MainGaia/PSC/AllWISE/indexjobscontinue. FulltotalsINCOMPLETE nohandoff.


## 2026-09-10T10:34:35.148209+00:00 — NEARGALCAT full data and lookup complete


Full HEASARC NEARGALCAT TDAT storage completed: 869 rows and 40 original fields,
115,004 data bytes (118,784 allocated), SHA-256
`0b1f6b4d93555dd7ba1ca547fcaef9a5f300a41e5a8feb59a721205e5ab9ab9f`.
The name/neighbour-name lookup has 1,737 field-scoped entries and occupies
81,920 bytes (86,016 allocated), SHA-256
`de15457ba96a6744ab6c8f05e2d34dd200976e72deeda1527682f21ae834e758`.
Combined measured components: 196,924 bytes. Data and lookup took 0.50 and
0.48 seconds respectively on existing task resources.

All 40 original field strings, metadata, bands, limits and empty cells are
preserved. Source gzip, decompressed TDAT and schema checksums were verified;
field order, record widths, all stored values, exact lookup locations, global
counts and SQLite integrity passed. Neighbour references are searchable source
facts rather than identity merges. The established overlap with Local Volume's
869 names and distances remains explicit; no extra physical population is claimed.
The previously rejected FITS request remains excluded from admitted source data.

Reproduce/resume with `python scripts/measure_neargalcat_storage.py data/storage-exhaustive-1271`.
Six focused TDAT/lookup regressions passed, including malformed data boundaries,
field order, null versus zero, exact names and lossless lookup behavior.
Completed replay checks source/data/index hashes and reuses receipts. Native
angular/rendering, interpreted relationships and API budgets remain unmeasured.

Newmeasure_neargalcat_storage.py,tests/neargalcat_storage_test.py1passed+fits_exact_lookup5passed. Genericlookupmapper nowacceptsFULL_TDAT_TABLE_DATA_COMPONENT_MEASURED single slot0; testsparamTDAT/CDS/VOTable. Inputneargalcat-source/full.tdat.gz/full.tdat/schema.txt pinnedreceipt. Outputsneargalcat-owned-storage/{manifest.json,detail.parquet,measurement.json} andneargalcat-exact-lookup. Aggregatene ar? exactfilename neargalcat-measurement.json andneargalcat-resume-check.json. Reporter neargalcat_owned_measurement mapsheasarc-neargalcat. Allrecordsmeasured withoutoldphysicaldistancefilter. NoNEARGALCATjobstillactive. MainGaia/PSC/AllWISE/indexjobscontinue. FulltotalsINCOMPLETE nohandoff.


## 2026-09-10T11:01:18.938094+00:00 — Green SNR summary measured; DESI acquisition started

Green October 2024 CDS VII/297 summary: 310 rows, all 18 fields preserved and second-pass verified. Data 38,075 logical / 40,960 allocated bytes, SHA256 434aecd6c51fe805356e2a84143d4825bac86dcb77667538f78b1414a46571ef. Exact SNR/Names lookup 391 field-scoped entries, 28,672 logical/allocated bytes, SHA256 d8a17832fe730617ff85b7be2e73868f80805e248873f892ed84a0aad291ab01. Combined components 66,747 bytes. Data/lookup took 0.417/0.306 seconds. All locators and global integrity passed; completed replay verified immutable hashes. Names field stays whole, not an asserted alias split or identity. Original J2000 angles, radio flux, angular sizes, classifications and uncertainty flags retained without invented depth. Detailed/candidate PDFs are separate retained documents, normalization pending. Driver scripts/measure_snr_summary.py; receipts snr-owned-storage; aggregate snr-measurement.json and snr-resume-check.json. Reporter and checklist updated.

DESI official archive and release docs verified: https://data.desi.lbl.gov/public/dr1/spectro/redux/iron/zcatalog/v1/ and https://data.desi.lbl.gov/doc/releases/dr1/ . Docs and provider checksums saved in desi-docs. Full zall-pix-iron.fits provider bytes 22,371,272,640 (metadata only); provider SHA256 2d95ad99361039b556c402b49e0e7c84df5f00106dc5731d44476a58b128b49b must be compared AFTER full acquisition. Local free disk measured 200,113,377,280 bytes before launch, source alone leaves ~177.7 GB. 100 GiB free guard remains an adjustable live-workload safety policy, not user quota. Probe 8,388,608 bytes in 4.371 seconds. Configured 2 MiB/s implies at least 10,667 seconds (~2.96 hours), probe rate ~3.24 hours; realistic initial expectation 3–5 hours excluding interruptions, not a completion deadline. Conversion/index workspace and timings remain UNKNOWN; reassess before launching those. No DB or infrastructure changes.

Full DESI download PID61580, command python3 -u scripts/download_catalog_ranges.py https://data.desi.lbl.gov/public/dr1/spectro/redux/iron/zcatalog/v1/zall-pix-iron.fits data/storage-exhaustive-1271/desi-source. Detached local process; worker desi-source-worker.json, log desi-source.log, chunks.json hashes/fsync checkpoints, manifest pins validators, progress.json. First 5 chunks 41,943,040 bytes observed after launch. Worker exits on transport error safely; resume same command after diagnosis. Never count downloaded ranges as rows or full measurements. Full source receipt still requires FITS audit and provider digest comparison. Reporter records acquisition separately and leaves total unknown.

Verification: 12 focused range-resume, CDS audit/storage, exact-lookup tests passed. Gaia/PSC and remote AllWISE/PSC index/AllWISE packed index continue; latest collector 1,969 AllWISE files / 111,318,077 rows. Gaia reporter 254/3386 files / 131,795,324 rows. Exhaustive source and serving totals INCOMPLETE; no complete_session.


## 2026-09-10T11:10:44.947297+00:00 — DESI schema pinned; owned compilation bytes measured

All six principal jobs remain active: local Gaia1418, PSC1419, DESI61580; remote PSC full index, AllWISE source/data, AllWISE packed index all ActiveState=active/SubState=running. PSC sync22249 active. Collector must use .venv/bin/python (system Python lacks pyarrow; initial call failed harmlessly, venv retry succeeded). Latest refreshed Gaia260/3386 files134863117rows; PSC80/92files410536074rows; AllWISE1990/12288files112476429rows. PSC index35committedfiles180057500rows30262136832logical bytes, still incomplete. DESI131chunks1098907648bytesobserved; localfree199410442240B. No shared DB writes.

DESI header-schema.json saved after verifying the first 8 MiB against its durable range SHA; fitsio.read_header(source.partial,ext=1) declares ZCATALOG136fields28425963rows787bytes/row. Status HEADER_METADATA_ONLY_NOT_FULL_ROW_AUDIT, rows_read null. All TTYPE/TFORM/TUNIT/TNULL/TDIM and full header text saved; header-text SHA9671a1769374d2611b8551b3a45a1d5c4cf7f58e9930a8dc6e2da618277040ac. This does not validate downloaded records or claim unique identities. COEFF10D fixed array, K64bitIDs/flags, Lbooleans, originalastrometry/epochs/photometry retained in contract. After download verify provider SHA, run full FITS audit, then assess bounded partition conversion workspace/memory before launch. Existing whole-HDU converter has growing metadata and only per-HDU checkpoints; consider bounded output partitions for this28.4mrowtable.

New scripts/measure_repository_catalog_snapshots.py measures complete existing owned compilations, verifies bytes against git HEAD3ac7cf6f4358f990c46eb95fd826465d6147fa0c and checks unique public keys/declared counts; Messier validates exactly M1–M110. Full JSON (all nested fields and metadata bytes) is already the owned file format, no lossy conversion. Messier110rows98411logical102400allocatedB SHA8999f59a736750afcb2a745f2b0f435484c7436f78395b23f5d6b67c795fbe53. Curated891rows1169351logical1171456allocatedB SHAe778a97f1ad156e49e92d883483a76c3bfefe92e1acafeaae45d51281307e963. Source and stored JSON are SAME artifact, count ONCE. Compilation scope only; not full upstream release coverage, not independent identities, not final serving totals. Metadata and existing selection retained. Evidence repository-compilation-measurements.json; rerun output repository-compilation-resume-check.json exactly matched via cmp. Reporter maps source/detail with identical artifact_id to disclose sharing; checklist updated.

Verification: compilation revision/row/key checks and byte-identical rerun passed; ledger regenerated; git diff --check passed. Exhaustive totals and required native serving artifacts remain INCOMPLETE; no completion handoff.


## 2026-09-10T11:18:27.439733+00:00 — Bounded FITS partition conversion implemented and verified

New scripts/measure_fits_partition_storage.py reuses original scientific arrow_table/verify_batch. Requires COMPLETE_SOURCE_READ audit plus unchanged whole-source SHA. Own marker/lock, immutable contract with library versions, defaults100000rows/partition1024rows/batch, full source FITS header and source row interval metadata. Every partition closes, second-pass compares every decoded scientific field, checks all row counts and schema/types/shapes/source metadata, fsyncs, renames and checkpoints. Resume verifies accepted SHA/bytes/intervals and does not rewrite accepted data. Only investigation-owned uncommitted tails can be recycled. Final receipt sums measured partition bytes, but global IDs/alias/angular/routing/rendering/crossmatches/API budgets remain unbuilt; full_serving_bytes null. Existing whole-HDU converter and old completed receipts unchanged. New format needs partition-aware lookup integration before an index can be claimed.

Verification: tests/fits_partition_storage_test.py (3 tests) plus fits_table_storage_test.py (1) all passed. Coverage: interrupted conversion/resume with accepted mtime preserved, uncommitted truncated tail, all rows covered exactly once, >2^53IDs, 2x3 arrays, NaN, null sentinel, boolean, names, original header, zero-row schema, changed partition contract, corrupted accepted file, changed source and injected all-field verification failure. Initial strict metadata comparison caught Parquet synthetic list child rename item->element; fixed by comparing scientific schema/types/shapes separately from exact source metadata. No scientific data comparison relaxed. git diff --check passed.

Separate DESI DIAGNOSTIC ONLY saved at desi-conversion-probe, reproducible helper data/storage-exhaustive-1271/desi-partition-probe.py. Source first10000rows copied from checksummed first8MiB range into standalone sample FITS; all136 decoded fields independently compared with downloaded original after conversion. Two5000rowpartitions, batch1024, data3468579logical3473408allocatedB; full converter wall1.76199s,115232KiB peakRSS. Sample sourceSHA d5bff2e63c9d7c4a086bf0643c855aab29fc20ce079e1224d07afdf9da402c3d. This is NOT a full DESI measurement nor a representative compression guarantee. Raw linear throughput implies ~1.4h conversion for28.4mrows, but full scheduling allowance2–5h remains an estimate excluding full source audit/indexes; storage must be measured over all partitions. Probe source/data/audit retained as investigation files. Reporter optional desi_conversion_diagnostic_sample stores scope explicitly; does not populate full-source/data cells. Main full DESI download still PID61580, no full conversion launched before provider SHA/fullsourceaudit.

After source download completes: compare SHA to provider2d95ad99361039b556c402b49e0e7c84df5f00106dc5731d44476a58b128b49b; .venv/bin/python scripts/audit_fits_source.py data/storage-exhaustive-1271/desi-source/source.bin EXPECTED_SHA data/storage-exhaustive-1271/desi-source/full-audit.json; assess live disk/memory headroom then .venv/bin/python scripts/measure_fits_partition_storage.py SOURCE AUDIT data/storage-exhaustive-1271/desi-owned-partitions. Source declared22.37GB; do not use diagnostic exact bytes as full-size total. Default285outputpartitions planned, source headers/arrays original science retained. Full index/alias/angles/native artifacts still separate.

Latest collected AllWISE2004files113229606rows; Gaia263files136374418rows. PSC81files415636074rows; localworkers1418/1419/61580 andsync22249 active. DESI204chunks1711276032bytes latest seen. Exhaustive source/serving totals remain INCOMPLETE; no completion handoff.


## 2026-09-10T11:24:22.048381+00:00 — Partition-aware exact lookup routing verified

Extended scripts/measure_fits_exact_lookup.py ONLY with a new partitioned receipt path; prior FITS/CDS/TDAT/VOTable formats and their accepted indexes unchanged. FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED inputs are sorted by original HDU/source_start, require contiguous non-overlapping intervals from zero, exact per-part/global row counts, unique output files, no duplicate empty partitions, and verified full detail hashes. Historical SQLite hdu column becomes a distinct partition slot for this new format; partition-routing.json maps each slot to original source HDU/start/stop/file/SHA. Original repeated IDs remain separate locators, no identity merge. Schema/format pinned separately. Routing JSON has own logical/allocated byte measurements and SHA; index_and_routing_bytes includes both. Every locator is verified even on resume, global SQLite counts/integrity checked. Missing/corrupt routing cannot silently be recreated after completion. Native API integration and angular/rendering remain separate/unbuilt.

Fixed new partition converter completion replay to preserve its original final measurement.json byte-for-byte after revalidating all partition hashes/row accounting. Otherwise changing elapsed-time metadata would invalidate the lookup source pin. Existing older measurement drivers untouched. Tests15passed across fits_exact_lookup_test.py, fits_partition_storage_test.py, fits_table_storage_test.py. New tests cover reverse-listed partitions, repeated >2^53IDs and leading-zero names, interrupted lookup after first row-group commit, source-row hydration through global slot map, index+route byte accounting, corrupt route refusal, gap/overlap/duplicate file/wrong global count/empty-then-nonempty partition rejection. Actual DESI diagnostic replay confirmed unchanged data receipt and accepted index/routing hashes.

DIAGNOSTIC ONLY: first10000DESIrows TARGETID/DESINAME lookup20000entries966656logical970752allocated bytes, SHA04893cceab64b34906a2b900a7bbf3c09fd599d4f32b8423812afd511c1e9c51. Separate2partitionrouting map662logical4096allocated bytes, SHAc955d49abaee084f777d219675674f07db399402736bfaf5d54ab7058c96e3d4. Index+routing967318logicalB. Build/all-locator/globalintegrity verification3.571seconds; no full-size inference. Raw linear timing at this diagnostic rate would be~2.8h for28.4mrows, but index growth/I/O/sourcewide IDs/cap differences are unmeasured; reassess full-job allowance before launch. Evidence desi-conversion-probe/lookup/measurement.json and explicit DIAGNOSTIC_SAMPLE_NOT_FULL_RELEASE wrapper lookup-probe.json. Reporter optional desi_lookup_diagnostic_sample does not populate full release cells.

Full DESI still downloading PID61580; latest291chunks2441084928bytes. Gaia1418/PSC1419 andsync22249 active. PSC82/92files420736074rows; AllWISE2027/12288files114557483rows. Remote PSC index/AllWISE source/AllWISE packed all SubState=running; remote diskfree188688146432B. No shared DB or production writes, no spend. Ledger refreshed and git diff --check passed. Exhaustive totals remain INCOMPLETE; no completion handoff.


## 2026-09-10T11:35:19.654333+00:00 — Full Legacy metadata inventory running; PS1 corrected schema access

Authoritative https://www.legacysurvey.org/dr10/files/ documents standard sweep columns as a subset and BRICK_PRIMARY=T row selection. Extra and light-curve sweeps together restore remaining Tractor columns for the selected rows; photo-z is additional row-matched science with sentinel/quality constraints. Therefore standard sweeps alone cannot stand for complete scientific Tractor records. Updated checklist to include full Tractor rows plus all four corrected DR10.1 sweep families, keeping overlapping records/observations distinct. Official NERSC listings and checksum manifests acquired to optical-access: legacy-10.1-sha, legacy-10.1-extra-sha, legacy-10.1-lightcurves-sha, legacy-10.1-photo-z-sha. All1436filenames in each match the directory list exactly with unique checksums; canonical sky-file names match across all4families5744files. Row alignment NOT verified and catalogue source bytes/rows remain UNKNOWN. Complete provider metadata in optical-access/legacy-sweep-inventory.json; metadata file sizes are not catalogue totals. Root legacysurvey_dr10_south.sha256sum covers only3summary files, not all science.

New scripts/inventory_legacy_tractor.py sequentially pins official full Tractor checksum manifests across all360directories from validated complete root listing. URLs https://portal.nersc.gov/cfs/cosmo/data/legacysurvey/dr10/south/tractor/NNN/legacysurvey_dr10_south_tractor_NNN.sha256sum. Own markers/lock, input root hash, per-directory rawSHA/fsyncedreceipts, checksum/brick-prefix/duplicate validation, bounded-memory file-list counts, 1srequestspacing, up to3attempts5/10swaits; reruns reuse verified metadata and retry failures. No source tables downloaded by this worker. PID69482; command python3 -u scripts/inventory_legacy_tractor.py data/storage-exhaustive-1271/optical-access/legacy-tractor data/storage-exhaustive-1271/legacy-tractor-inventory; workerJSON legacy-tractor-inventory-worker.json; log legacy-tractor-inventory.log. Last76/360directories97519providerlistedfiles/errors[] at~5min. Provisional20–60min metadata runtime (notdeadline). RAM~18MiB; metadataonly existingresources. Checksums pin individual files; coherent full source release/row audits still pending.5legacy_manifest_inventory tests passed malformed/duplicate/wrong-directory/empty checksums.

PS1 official updated retrieval doc linked https://mast.stsci.edu/vo-tap/api/v0.1/ps1_dr2/ but /tables and metadataqueryHTTP400. Captured VOTable error body explicitly listed valid path ps1dr2 (no underscore). Corrected https://mast.stsci.edu/vo-tap/api/v0.1/ps1dr2/ works: capabilities, tables, and SELECT table_name,description FROM TAP_SCHEMA.tables plus SELECT * FROM TAP_SCHEMA.columns (read-only metadata). Saved responses/receipts optical-access/ps1-corrected-*;69table definitions incl5TAPmetadata tables,5602column definitions with exact datatypes/units/array sizes/descriptions. Every column table maps to listed table, (table,column) unique, far below100000cap. SchemaCSV827327bytesSHAde6333bf09a3e9aa65341b38a71451678decf8bf2ce52a5611c725fd0c16908d. ObjectThin51fields, MeanObject82, StackObjectThin107, Detection58. ps1-schema-inventory.json preserves alltable descriptions/counts; do not treat views/repeated detections/flag tables/image metadata as newphysicalobjects. Corrected capabilities still hard100000rows. Full acquisition unresolved; investigate supported CasJobs/bulk alternative, no massinteractivepaging. Previous404/400evidence retained, access-gap.json updated with resolved schema route and remaining full-data gap. No PS1 catalogue rows claimed measured.

Reporter optional new metadata hooks map Legacy/PS1 gaps without filling source/storage totals. Current Legacy worker is additional localmetadatajob; Gaia/PSC/DESI/sync and remoteAllWISE/PSCindex/AllWISEpacked continue. LastPSC83/92files425836074rows; AllWISE2042files115466415rows; Gaia272files140900105rows. Full exhaustive totals/servingartifacts INCOMPLETE; no completion handoff.


## 2026-09-10T11:42:09.043262+00:00 — First full Legacy Tractor file measured, remainder incomplete

Acquired official full Tractor partition https://portal.nersc.gov/cfs/cosmo/data/legacysurvey/dr10/south/tractor/000/tractor-0001m002.fits using scripts/download_catalog_ranges.py into legacy-tractor-first/source. Provider checksum matches published000manifest exactly: SHA5917f922eb336e72db771f8ca1e28de690b337aa88cbe01beffb2d53b3b85fa1. Measured source22213440logical22216704allocatedB,3ranges10.225snetwork. Full audit9051rows207fields took0.998s. All rows/fields/fixedarrays/flags/units/original astrometry preserved by measure_fits_partition_storage.py, data13975781logical13979648allocatedB SHA16619d41bbd5928f5ea338d354da4ab796b6c5160955dfd7e548a7ae3189ca84;4.197spartitionprocessing, peakprocess111612KiB. This is ONE full file, not a full Legacy release and not a representative size guarantee. No source-wide total extrapolated. Wrapper legacy-tractor-first/measurement-scope.json explicitly ONE_FULL_TRACTOR_FILE_ONLY_NOT_FULL_RELEASE, full_source_bytes/full_serving_bytes null. Full receipt/audit under that root.

All9051composite RELEASE/BRICKID/OBJID keys unique within file.8737BRICK_PRIMARY true,314false; all retained. TypesPSF3583/REX4209/DEV228/SER173/EXP858; this file contains noDUP, but converter performs no type filter.207fields includeflux_i. Source semantics/fullheader saved source-semantics.json. Actual immutable source/data receipt replay passed after checking hashes; resume-check.json saved. Global composite identity lookup, inter-brick associations, angular/physical routing, rendering and native APIs remain UNBUILT. Do not treat individual objid or ref_id as a global identity.

Official https://www.legacysurvey.org/dr10/issues/ captured in optical-access/legacy-known-issues.html and receipt: provider documents header/statistic discrepancies, duplicate ref_ids, bailout areas, and598SUB_BLOBaffectedbricks reprocessed2023. Corrected RELEASE10002 rows coexist with unchanged10000 rows; full Tractor directory replaced affected files,10.0/10.1sweeps retained separately. No claim that current file headers alone establish correct scientific completeness. Inputoriginalmeasurements/flags must remain intact. Full schemas may vary across products; source-by-source audit required.

Tried read-only rsync module listing via existing Apps Server /usr/bin/rsync: rsync --list-only --contimeout=10 --timeout=20 rsync://portal.nersc.gov/ . Failed connectiontimeout(code35), stdout/stderr stored optical-access/legacy-rsync-modules.txt/.stderr. No rsync-installed changes, transfers or remote DB changes. HTTPS manifests/data remain working path, so not an overall external blocker. Localrsync unavailable; no install needed.

Legacy metadata worker69482 stillrunning, latest237/360directories247785providerlistedfiles,errors[]. No full catalogue rows/bytes implied. Full source workerGaia1418/PSC1419/DESI61580 andsync22249 remain active. LastPSC85/92partitions436036074rows,AllWISE2078files117470829rows; updatedGaia276files142899594rows. Reporter new Legacy first-file scoped/semantics/knownissues hooks preserve nullfulltotals. Ledger regenerated; git diff --check passed. Exhaustivecatalogue andserving totals INCOMPLETE; no completion handoff.


## 2026-09-10T11:50:10.543393+00:00 — Legacy manifest set complete; own worker limits adjusted to measured headroom

Legacy Tractor metadata worker69482 FINISHED. All360official checksum manifests pinned/reconciled:366912unique-by-directory provider files, zero errors. Raw checksum metadata32288256logical33079296allocatedB; these are METADATA bytes, not catalogue source bytes. Successful fetch timestamp window 959.299seconds. Completed rerun of inventory_legacy_tractor.py freshly verified every metadata SHA, parsed every filename/checksum and directory-prefix consistency, and reproduced exact inventory.json; output legacy-tractor-inventory-resume-check.json and verification.json. No scientific row/source/full-serving totals inferred. Source-wide release coherence still unaudited; only firstTractorfile9051rows207fields previouslymeasured. Checklist/reporter updated; do NOT keep calling Legacy metadata worker active.

Measured Apps Server8CPUs,67.2GBRAM,58.74–58.85GBavailable. CPU live samples beforechange75–89%idle (vmstat first historical row excluded). All3ownedserviceswereCPUQuota25%,Nice19,IOWeight1,MemoryMax512MiB,MemorySwapMax0. Runtime-only quota changes via sudo systemctl set-property --runtime: PSCfullindex100% (one CPU),AllWISEsource100%,AllWISEpacked50%;combinedceiling2.5of8CPUs. All services remained running; follow-up liveidle77–85%. No system/sharedDB/appconfig changes, no new spend or infrastructure. Baseline/readback in apps-quota-baseline.txt/apps-quota-after.txt.

PSCindex cgroup memory.events recorded2329100historicalmaxhits with zeroOOM/kills;MemoryCurrent~536.8MBat512MiBcap,I/Opressureavg10~14.75%/avg60~10.58%. With58.74GBhostavailable, raised only PSC index MemoryMax to4GiB runtime; swap0,lowI/Oweight/Nice19,CPU1coreunchanged. Follow-upliveCPUidle74–85%; initialMemoryCurrent~537MB thencachesmaygrowtoward4GiB. Evidence psc-index-pressure-before.txt,psc-index-memory-after.txt,psc-index-pressure-after.txt. Memory-ceiling hits and I/O stalls justify trying more filecache; they do not prove a performance gain. No throughput improvement claimed yet; continue observing and lower own limits if actual workload headroom worsens. This4GiBlimit is an adjustable experiment memoryceiling, NOT user scratchbudget or completioncriterion.

Structured resource phases: owned-worker-resource-adjustment.json, reporterhook owned_worker_resource_adjustment. Full-job timings now span differentCPU/memorylimits; do not compare against quarter-core trial rates as if controlswereconstant. Logicalfinalartifactbytes unaffected. Existing source pipeline/accepted records untouched. PSCsource86/92files441136074rows lastobserved; AllWISE2096files118464902rows; Gaia/DESI/sync stillrunning. Full scientific/source/artifact totals INCOMPLETE; no completion handoff.

Post-change readback: PSCcgroupMemoryCurrent4294443008B (~4GiBincludingfilecache); hostavailable58613366784B. I/Opressureavg10=17.29/avg60=15.80 atthissample, so no evidence of reducedstalls yet. Workercontinues; leaveperformancegainunknown and watchfutureprogress/resourceheadroom. LatestGaia280files144918681rows.


## 2026-09-10T11:57:59.246450+00:00 — Complete built-in metadata compilations measured

New scripts/measure_static_catalog_compilation.py extracts ONLY literal CATALOG_OBJECTS and its plain-dictionary catalog_object constructor plus CATALOG_GROUPS from backend/catalog_sources.py, with SUN_MU constant from backend/settings.py. AST validation refuses dynamic constructor expressions/kwargs. Does not import app/module-level loaders, fetch ephemerides or touch DBs. Compiles exact constructor defaults, preserving None versus zero, all public keys and nominal source values; no scientific reinterpretation. Both source files matchgit3ac7cf6f4358f990c46eb95fd826465d6147fa0c; source37765B SHA6d77ce7337f21933d1c8dbd67aecfe9c4e968c4d1ed6155e65b0a4f82e13de84 andsettings1248B SHA3a1079ca2a33e002f1cfe3689ff5cd3b5f6f103eea9cb923f22436ffc6a01c2e. These shared code files countonce, notfourtimes.

All40built-inmetadatarecordsserializedto4owned diagnosticJSONartifacts45412logical53248allocatedB total: core11rows12186/12288B SHA657445af5fe498235c7e1deccadd8717b45dc612ef459147adc7578166a0b54c; Mars2rows2631/4096B SHA52eeec690c83fd2aae68d628fe2eea27cdea27261f006ad54616cff91e8df9d4; Jupiter/Saturn11rows12434/16384B SHA0fab40a9d196b7817cb3eafca0357668002c8a0fb783a1530d72091c950faa2b; nearby16rows18161/20480B SHAe877aab5f927eea77ea4104920d8e5ef06f3ca3b2a9a5818c7102399b5d347a7. These are complete current built-in metadata only, not complete upstream star/moon releases or dated ephemeris datasets, and not a new productiondataformat. ExistingmeasuredDE440s/MAR099s remainseparateartifacts; Horizons response/caches,rendering,indexes/nativeAPIbudgets stillunmeasured.

Reproduce python3 scripts/measure_static_catalog_compilation.py . data/storage-exhaustive-1271/static-compilations. Receipt static-compilation-measurements.json, rerunstatic-compilation-resume-check.json byte-identical via cmp; accepted outputs are verified/reused. Allserializedfields/metadata roundtrip checked.2static_catalog_compilation tests passed (defaultsNone/zero/constants and refusalofdynamicexpressions; module-levelraiseneverexecuted). Reporter static_compilations maps explicitly metadata-only data components with nofulltotals; giant-planet/nearby checklistupdated. git diff --check passed.

Workersremainactive: localGaia1418/PSC1419/DESI61580/sync22249; remotePSCindex,AllWISEsource,AllWISEpacked running withnewlimitsdocumentedpriornotes. LatestPSC88/92files451336074rows; Gaia283files146441922rows; AllWISE2141files120911380rows. PSCglobalindex38files195491000rows32833605632logicalbytes lastremotecheckpoint. Hostavailable58789154816B; PSCI/Opressureavg10=8.79/avg60=11.06, no causal speedupclaim. Legacy manifestworkerfinished andverified360dirs366912providerfiles; doNOTcallitactive. Exhaustive source/serving totals INCOMPLETE; no completionhandoff.


## 2026-09-10T12:29:07.847616+00:00 — Full PSC source/data completed and independently audited; exhaustive scope incomplete

PSC1419 and sync22249 FINISHED successfully. progress COMPLETE_DETAIL_COMPONENT92files470992970rows, remote-sync ALL_92_INPUTS_TRANSFERRED. Do NOT call these workers active. New reproducible data/storage-exhaustive-1271/audit-psc-completion.py freshly hashes all92 retained projection files, validates Parquet counts/12columns, exact manifest coverage,60field format/allfield+CRC receipts and16release integer verification sums. Allpassed. Full compressed source ACTUAL42672321835B, candidate data48263451660logical48263995392summedallocatedB. Projection workspace15823556986B. Source/detail temporaries recycled per original verified protocol; no claim they currently coexist. completion-audit.json receipt-setSHA46dbeba32dc85910ae9f97c8f9db9823ca03fe6558428d97f50f4831441fc099; source manifestSHA7049697f211b5c15b6f2e4eb9ee0c5e5eb88df1100dece7a51b947585c498028; schemaSHA1f9596c066f29c7556e3481c8bd66aec7e27fb1d53cc542dc2af38629f8f22c2. Globalindex BUILDING last43files221213500rows37143724032logicalB. Full serving/peakworkspace unknown.

Reporter completion-audit hook now records full measured source and60field candidate artifacts, labels global index incomplete. Checklist milestone supersedes old partialPSC/provider-only paragraphs. Reporter ran, py_compile and git diff --checkpassed. Readback asserts52entries, exactPSCbytes, unknownroutingnull and honest generatedtable. AllWISEcollector completed2319files130697133rows63268939590source/72603906366candidate/4795013690projectionB. Gaia299files154710156rows; DESIactive61580last8808038400of22371272640sourceB1050chunks. Remote3servicesactive;58.58GBavailableRAM177.86GBdiskfree. Local188.97GBfree. NoDBtouch/spend/newinfra/deployment.

SDSS authoritative docs/listings pinned sdss-access/. DR18 no newimaging, inheritsDR17; finalimagingcalibrationDR13, requirecalibrationcrosscheck. FulltargetPhotoObjAll inclparent/secondary/other, notfilteredPhotoObj/reducedPhotoTag. photoObj fullFITScorrespondsPhotoObjAll+PhotoProfile,139modelcolumns arrays,originalunits. Successful officialrsync modulelist via existingApps rsync; savedrsync-modules.txt/.stderr. Now RUNNING own execsession61882: ssh sk-apps-server-1 rsync --no-motd --list-only --recursive --contimeout=10 --timeout=60 rsync://dtn.sdss.org/dr18/prior-surveys/sdss4-dr17-eboss/photoObj/301/ withstdout sdss-access/photoobj-301-rsync-list.txt stderr same.stderr. Last504260lines; READONLYmetadataonly. Poll61882 tosuccessfulcompletion, hash/parseunique scientificfilepaths+sizes separatelyfromaux/checksummetadata, publish as PROVIDER METADATA, notmeasuredsource. acquisition-status.json recordspending. Officialbulkguidehttps://www.sdss.org/dr18/data_access/bulk/ requiresarrangedcustomtransfer>1TB; no helpdeskemailauthorized/sent. Establishvolume first, safealternativespending. photoRunAll-dr17.fits187200B runmetadata and301/1000/photoObj_301_1000.sha1sum fetchedHTTPSwithreceipts; noindividualphotoObjsciencefiledownloadedyet. Main docmodelhttps://data.sdss.org/datamodel/files/BOSS_PHOTOOBJ/RERUN/RUN/CAMCOL/photoObj.html SHA b84f29d9bf9cebfd1c6ea81ba93061ac5c040be285e336b6e7065cbeb2b1f24e. rsyncMOTD alsoaskshelpdesk for manyTB;max10connections, usedone.

Remainingactive Gaia1418,DESI61580,workspaceobserver1935;remotePSCindex/AllWISEsource/AllWISEpacked. Legacyinventoryfinished previously. Exhaustivecatalogue/nativeartifacttotals INCOMPLETE; do not complete_session. NextpollSDSSlisting, continuefullsource/globalartifactwork and monitordiskheadroom.


## 2026-09-10T13:23:59.253066+00:00 — SDSS per-run inventory running; first complete file verified

Old whole-tree SDSS exec61882 no longer exists; no process active, stdout ended midtree5194/2 at12:29:19 with54297652B and no successful exitreceipt. NOT COMPLETE. Preserved unchanged. Replaced with scripts/inventory_sdss_photoobj.py: onlyread-onlyremote rsync metadata, root765numeric runs pinned, perrunrecursive listings acceptedonlyexit0 withstrictparser, fsyncedrawSHAreceipt, validatedresume, max3retry. New detachedlocalPID81483; workerJSON sdss-run-inventory-worker.json, logsdss-run-inventory.log,rootsdss-run-inventory/{OWNER,root.txt/root.json,run-ID.txt/json,progress.json,inventory.jsonwhenfinished}. Last53/765runs56082PhotoObjfiles180380263680PROVIDERbytes plus424aux167957433PROVIDERbytes. ALL DIRECTORY METADATA, notmeasuredscientificsources. Initialrough1h listing estimate based20runs/~1min; variability notdeadline. No fullSDSSscientifictransferauthorizedthroughprovider yet; >1TB officialcustomtransfercontactconstraint remains. Noexternalcontactsent.

FirstSDSSfile HTTPSdr18.sdss.org timedoutTLSbeforeHEAD; alternateofficialdata.sdss.org/sas/dr18/prior-surveys/sdss4-dr17-eboss/photoObj/301/1000/1/photoObj-001000-1-0027.fits succeeded via download_catalog_ranges.py. Source sdss-first-source/source.bin6612480logical6615040allocatedB SHA199593fb3673b9e3de06d183597af48ec024e87110193ab5fe4b9736056763c6; providerSHA1f62d2013f3ba708b72a8b6561a3aa3bfa806ff03 matchesdownloaded1000manifest. Full audit2186rows139fields0.114s, allfieldpartitionconversion1.305s candidate4466225logical4468736allocB SHA52493ff85edb91552a3004a1461c612e754eb6b8506d7f300e6e0edd16362886. AllrowsincludingMODE1:1447,MODE3:495,MODE4:244retained; mode4notinventedsemantics. OBJID originalstrings >2^53, fullarrays/headerspreserved. sdss-first-data/measurement.json, verifiedidenticalresumereplaysdss-first-data-resume-check.json. Wrappermeasurement-scope.json explicitlyONE_FULL_SOURCE_FILE_MEASURED_NOT_FULL_SDSS_RELEASE, fullsource/servingnull. Noextrapolation,fullcalibrationcoherenceunverified. ThisfirstfilejobFINISHED.

7SDSS testscoverbigintlistingbytes/unsafeorduplicatepaths/failedlistingoutput/missingroot andofflinecompletedresume/hashcorruption;5Legacytestsregressionpassed. Reporter new optionalSDSSacquisition/runinventory/firstfilehooks; generatedledger/checklistupdated, py_compile andgitdiffcheckpassed. Small diagnostic initial audit display len(fields)TypeError becausefieldsisint, no measurementfailure; properconverter/audit/replaypassed. Full52entrychecklistunchangedscope.

Otheractive workers Gaia1418 (latest342files176779242rows), DESI61580 (~14GB/22.37GB), workspaceobserver1935; remotePSCindexlast51/92files262369500rows44151578624logicalB, AllWISEsource2536files143706811rows69566124501source79826799767candidate5256320020projectionB, AllWISEpacked2534runswaitingnextsource. PSCsource1419/sync22249 FINISHED92files previouslyverified,doNOTcallactive. HostRAM58.73GBavailable/disk170.18GBfree; local182.79GBfree. NoDB/spend/deploy/newinfra. NextmonitorSDSSperrunlisting81483, DESIsourcecompletionthenfullchecksum/audit/conversion, continuefullglobalartifacts. ExhaustivefulltotalsINCOMPLETE,no completion_session.


## 2026-09-10T13:28:55.938537+00:00 — DESI full audit/conversion queued after source download

Sourceworkers continue. CurrentGaia347/3386files179357362rows;DESI61580at14898167808of22371272640B1776verifiedchunks; SDSSinventory81483last123/765runs124722PhotoObjfiles414534003840PROVIDERmetadataB. OldwholeSDSSlisting remainsincomplete; perrunresumableworkerisactive. RemotePSCindex52/92files267514000rows45034762240logicalB, AllWISE2562files145383997rows70412076434source/80788513307candidate/5316957846projectionB.3remoteunitsactive. Localfree180.75GB,hostfree169.57GB/RAM58.60GBavailable. Localcgroup768MiB nearceilingmostlyreclaimablefilecache:anon388341760/file326942720/kernel46329856B,memoryOOM0; pressureavg10~1%. Noresourcechanges.

Newtaskownedorchestrator data/storage-exhaustive-1271/run-desi-full-conversion.py launched detached. PID83278, workerJSONdesi-conversion-worker.json, logdesi-conversion-worker.log, progressdesi-conversion-worker-progress.json. CurrentlyWAITING_FOR_COMPLETE_SOURCE,30spolls. Onlyafter source.binANDfullreceipt exist: requireFULL_SOURCE_BYTES_ONLY22371272640B andofficialSHA2d95ad99361039b556c402b49e0e7c84df5f00106dc5731d44476a58b128b49b; verifyactualsource length; require140GiBfree(existing100GiBadjustableliveguard+40GiBconservativeworkspaceallowance). Full audit_fits_source.audit rehashesandreadsallfields ->desi-source/full-audit.json; requireone28425963row136fieldtable.Then measure_fits_partition_storage.measure(source,audit,desi-owned-partitions,100000,1024),allfieldssecondpass/durablepartitions and100GiBliveguard. Existingpinnedauditreusedonresume,converterfreshSHArequired. ReturnsCOMPLETE_DATA_COMPONENT_ONLY,fullservingnull; errorspersistFAILED_REQUIRES_REVIEW thenexit. Fullgloballookup/angular/nativebuildsNOTqueuedyet. NoDB/newinfra/spend/deployment.

Feasibilitydesi-conversion-feasibility.json: full10krowprobe115232KiBRSS, earlier1.762sconversion; provisional2–5hfullconversionallowance,notmeasuredruntime/deadline; candidate~10GBislinearprobeestimateNOTtotal. Disk40GiBstartupmarginconservativeandadjustableagentguardnotuserlimit. Queuedwaiteronlyimportsstdlibuntilsourcecomplete,fullauditedconverterusesexistingtested1024batch/100kpartitioncontract. No sourcefilesdeletedbyorchestrator. ReportoptionalhookscompleteDESIsource/fullaudit/conversionworker/feasibility/partitionprogress+measurement; requiremanualfullresultverificationbeforecountingcomplete.

Verification15focusedFITSsourceaudit/partitionstorage/exactlookup tests passed; reporterregenerated; py_compilebothorchestratorandreporter,gitdiffcheckpassed. Exhaustivecatalogue/artifacttotalsstillINCOMPLETE; nohandoff. Nextmonitor81483SDSS765runinventory,61580DESIdownload+83278conversion,Gaiaandremoteindexes; checklivecapacitybeforelargerbuilds and do not confuse metadata/filecomponentswithfullservingtotals.


## 2026-09-10T13:35:43.746418+00:00 — Full SB-SAT API snapshot and exact lookup measured

Resolved52entrysmall-body-satellites via officialhttps://ssd-api.jpl.nasa.gov/doc/sb_sat.html (31722Bdocpinned) andAPIhttps://ssd-api.jpl.nasa.gov/sb_sat.api?orb=1&sigma=1&phys-par=1&fullname=1&class=1&confirmed=all . FullunfilteredAPI1.0snapshot531records177460sourceB SHA4b9181dc5fa52c5637f8bd37955f66c54bc0183b1131b73d0ecc3b1bceb838c6. Source/docs/HTTPreceipts sb-sat-source/. No limit/kindfilter,nopaging;APIcount531reconcilesactualrows. Allavailableoptionaldatarequested;defaultorbitsonly,NOTallhistoricalsolutions. Originalprimary-centricframes/epochs/sigma/physicalunits/refsmustremain;donotinferheliocentriccoordinates.

New scripts/measure_sb_sat_storage.py verifiespinnedSHA/APIexactsignature/count/duplicatenestedJSONkeys, storeslosslessnestedJSONL+originalnondataresponsemetadata, buildsSQLiteexactlookup(field,value,ordinal,offset,length)forpdes/sat_fullname/iau_namewithoutmergingparentIDs. WholeJSONsemanticroundtrip+all637locatorscheckedoffline,globalSQLitecount/integrity,finalSHAreceipts,ownedlock/manifest;completedreplayhashchecksneverreplacecompletedartifacts. Recordswithmissingnamesretained:467of531have nullsat_fullname;initialtoo-strictidentifierassertfailedBEFOREoutput,removedandregressiontested. No source datachanged. 495confirmed36unconfirmed,511primarydesignations,88withorbit,8phys_par. No claim531establishedidentitiesorvalidpropagatableorbits.

Completed sb-sat-owned-storage/:data177359logical180224allocB SHAca2a84308c1fac7f099b73f3dab11f2e2382a1ab228730d37a1b988c4b3d80cf;SQLite49152logical/allocB SHAa5fc5208c082d5407b15b5d25c1f8fa95cb475466eded6c213ad7c342941f0fa;metadata116logical4096allocB SHA72fe28f30c47d5c964899ff40834db38fcf6c2b7ca53743213bc889ac8fa85db. Sum226627B;includingpinneddocumentation31722B=258349Bmeasuredcomponents. Optionaloriginalsourceretentionseparate. Measurement0.47477s;allnestedfields+locatorsverified;resumeidenticalandfreshhashes, resume-check.json. sb-sat-measurement.jsonwrapperincludesdoc/sourceHTTPevidence;originalmeasurementunchanged.

3sb_sat_storage tests passed:losslessnestednull/absence/zerostring/largeIDs,duplicateparentrelations,missingidentifiersretainedbysourceordinal,schemaversion/count/duplicateJSONrejection,completedresume/corruptionrejection. Reporteroptionalhook+small-body-satellitesrowrecordsfullsnapshotdata/index/doccomponentsbutleavesrendering/ephemerisunknown. Checklistupdated,reproducibleCLIshown. Ledgerreadback52entries,source177460/data+metadata177475/index49152,physicaltilesnull. Reporter/py_compile/gitdiffcheckpassed. Exhaustivecatalogue/artifacttotalsINCOMPLETE,nohandoff.

WorkersstillactiveGaia1418latest352files181917803rows;DESI61580at15569256448/22371272640B1856chunks;queuedconversion83278WAITING_FOR_COMPLETE_SOURCE;SDSS81483at252/765runs279132PhotoObjfiles964633037760PROVIDERmetadataB plusaux833485908B. Listingnearing1TBmetadata, official>1TBcustomtransfercontactconstraint remains, noemailauthorized/sent;finishmetadatafirst. RemoteAllWISE2580files146267004rows70834581283source81267258816candidate5347941639projectionB,3unitsactive. LatesthostRAM54.82GBavailable/disk170.36GBfree,local180.42GBfree. NoDB/newinfra/spend/deploy. SB-SATjobDONE,donotcallactive. Continuefullsources/indexes/SDSSinventoryandDESIqueuedaudit.


## 2026-09-10T13:42:33.841132+00:00 — Spacecraft metadata inventory measured; all-target metadata worker active

Existingbackend_phoenix/priv/spacecraft.json exactlymatchesgit3ac7cf6f4358f990c46eb95fd826465d6147fa0c:94388logical98304allocB SHAa5d8ea46b0b40cc1f1de1032df638964cda3a3f4b681795dae5d141ba3ee46b6;97included153excludedIDs. FetchedcompleteofficialHorizonsSupport APIhttps://ssd.jpl.nasa.gov/api/horizons_support.api?time-span=1&list=spacecraft :250uniqueIDs70058B SHA1e215e70f620843237341b805b2a3095137d33a5a073d1e65b92865ca4d95b12,supportsignature1.0. Exactlyreconciles250checkedmanifesttargetIDs,noneadded/missing; doNOTtreatalternative/excludedtargetsasuniquevehicles. Appmanifestsource/storedmetadataSAMEartifactcountonce. Evidence spacecraft-source/full-inventory.json+receipt andspacecraft-inventory-measurement.json. Trajectory/kernel/cache/nativefullsizesunknown; nochangesexistingmissionpolicy.

Firsttarget-92metadataJSON viahttps://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND=%27-92%27&MAKE_EPHEM=NO measured3046B0.707s,signatureNASA/JPLHorizonsAPI1.2,resultnonempty,noerror. Storedspacecraft-source/probe-minus92.json+receipt,reusedbyworker. Newtaskownedacquire-spacecraft-metadata.py serial250targetmetadata-onlyworker,1srequestspacing,3attempts5/10sbackoff,strictsignature/nonemptyresult/noerror,targetURL/IDpin,fullrawSHA/fsyncreceipt,acceptedresumehashverification. Rootspacecraft-source/target-metadatahasOWNER/manifest.json/progress.json,targetID.source.json/.receipt.json,measurement.jsonwhenfinished. Noephemerisvectorrequests,nomissionadmissionchanges,noproductionwrites. Per-responsecapturetimestamps,NOTatomicupstreamrelease/allhistoricalsolutions. Provisional10–30minfromprobe1sintervalestimate,notdeadline.

InitialPID86587failedbeforetargetrequests becauseAPIcodeisstring"200" notint;fixedvalidationacceptboth,previouslogpreserved. ACTIVEreplacementPID86675; workerJSONspacecraft-metadata-worker.json,logspacecraft-metadata-worker.log;doNOTcall86587active. Latest35responses71828sourceBfreshlyreverifiedallhashes/fullJSON/signature/queryNO/targetIDwithzeroerrors;verification-checkpoint.jsonisPARTIALcompletedreceiptset,NOTfull250. Workercontinues;rawmetadataonly,nottrajectorysizes.

Reporteroptionalinventory/currentmanifest/targetmetadataprogress+measurementhooks;spacecraftdatafield94388labelledcurrentmetadataonly;fullsource/trajectory/nullrenderremainunknown. Checklistscopeandestimatedruntimeupdated. Measuredmanifest/supportIDsetschecked;35rawresponsehashesandnoerrorpayloadsreverified;52entryledgerassertionspassed;py_compiletaskworker/reporterandgitdiffcheckpassed. Noapplicationtestsneededforread-onlymetadatareceipts. Fullcatalogue/nativeartifacttotalsINCOMPLETE,nohandoff.

OtherworkersactiveGaia1418latest356files183976132rows;DESI61580at15787360256of22371272640B1882chunks;DESIconversion83278stillWAITING_FOR_COMPLETE_SOURCE;SDSS81483at292/765runs330906PhotoObjfiles1153888024320PROVIDERmetadataBplus986796264aux. SDSSnowexceeds1TBproviderlistedminimum;officialcustomtransfer>1TBconstraintthereforerelevant,doNOTlaunchbulktransferwithoutresolvingproviderpath;noexternalcommunicationauthorized/sent. Finishfullmetadatainventoryfirst. Remote3servicesactive,AllWISE2606files147592234rows71468610010source81987699052candidate5394479041projectionB. Localfree179.33GB/remote170.09GB/RAM58.72GBavailable.NoDB/deploy/spend/newinfra.


## 2026-09-10T13:50:22.460977+00:00 — BZCAT5 candidate measured; spacecraft target metadata finished

Broadblazarsentryoriginalcuratedsource"NED/SIMBAD blazar catalogs"stillunspecified. ExplicitcandidateRoma-BZCAT5(2015),CDSVII/274 ReadMe2016-02-11 measured;NOTassertedprovenance/exhaustionofallhistoricalcuratedcompilations. Sources https://cdsarc.cds.unistra.fr/ftp/VII/274/ReadMe (5654B) andbzcat5.dat (476769B)capturedwithSHA/URL/date inbzcat-source/. Full3561rows20fields. SourceSHA b34207b1f109a0286a8d5eb5dfb2d5c2010e44992560e4c8cca2eb1d10037367. Reused audit_cds_fixed_width.audit(...pad_short_records=True),measure_cds_table_storage andmeasure_fits_exact_lookup Seq/Name. No newscientifictransformations: originalstrings/J2000/class/candidate/u_z/bandunits/zero-missingsentinelsretained.

bzcat-owned-storage/:data143047logical143360allocB SHAa6012e9c99dbfa5bb50d8e811dad68ca83538fc38b3f42118f42c6a252dc7aab,1.180s;lookup7122entries221184logical/allocB SHA432f1ea8fe3a08868ccce1519ca8954e8b0d957fe8072a7df11528cf887d24d7,1.400s;sum364231Bdata+lookup,ReadMeseparate. Allfieldsecondpass/alllocators/globalSQLiteintegrity; completeddatareceiptidenticalandindexhashunchangedonreplay,resume-check.json. 5CDSfocusedtests passed. bzcat-measurement.jsonwrapsexactcandidate scope;reportoptionalhook+candidate_release_measurementonblazarsentry; originalcomplete_sourcecellstillnull,52entryledgercheckpassed. Do notcallbroadentryresolved.

Classificationaudit matchespublished5BZB1151/5BZQ1909/5BZG274/5BZU227 and92BL_LacCandidate. UniqueSeq3561butuniqueName3560:5BZB J1701+3954 occursTWICE. InitialassumptionuniqueNameassertfailed;investigatedandpreservedbothsourceIDs/alllookupmatches,classification-audit.jsonrecordsactualduplicate. Noobjectsmerged. Docs/checklistclearlycandidateonly,fullangular/crossmatch/nativeartifactsunbuilt.

Spacecrafttargetworker86675 FINISHEDall250metadataresponses,noerrors. FullCOMPLETE_PINNED_TARGET_METADATA_ONLY536924logicalB. Re-ran taskownedacquire-spacecraft-metadata.py once usingallacceptedreceipts(noacquisition),outputspacecraft-metadata-resume.log. Independentfreshall250rawSHA/length/API1.2signature/noerror/nonemptyresult/MAKE_EPHEM=NO/requestedIDchecked;IDsreconcileexact250supportmanifest. verification-complete.json:536924logical1159168summedallocatedB,receipt-setSHAd63c82ccfd212bd4a73a5b39d40ca5839802453d94c41b43a4d1d4d21d3faab7. Sourcecapturesspanper-responsetimestamps,notatomicupstreamhistoricalrelease/uniquevehiclecount. Trajectoryfullbytesandservingnull. DoNOTcallspacecraftworkeractiveagain. Reporternewverificationhook/checklistfinishedmetadata update;existing97/153decisionsunchanged.

OtherworkerscontinueGaia1418latest361files186543084rows;DESI61580last16475226112/22371272640B1964chunks;queuedDESIconversion83278WAITING_FOR_COMPLETE_SOURCE;SDSS81483last449/765runs529110PhotoObjfiles1956664690560PROVIDERlistedB. SDSS>1TBofficialcustomtransferconstraintalreadydocumented,noexternalcontactauthorized/sent. RemotePSCindex55/92files282947500rows47669248000B;AllWISE2629files148788243rows72041309945source82639700723candidate5436359638projectionB;3unitsactive. Host58.77GBRAMavailable169.61GBdiskfree/local178.48GBfree. NoDB/spend/deploy/newinfrastructure. Reportregenerated/py_compile/gitdiffcheckpassed. ExhaustivecatalogueandservingtotalsINCOMPLETE,nohandoff.


## 2026-09-10T13:57:57.939892+00:00 — Gaia partial global routing expanded and verified

Reused scripts/build_gaia_id_routing.py to extend ownexistinggaia-full/id-routing.sqlite from61 to365files188594888rows. Actualglobalrangeartifact7364608logical7368704allocB SHAecb26f58f3834c7b2f3050cb06cd2b0665909c3db0a59d8e64a160ffa000eb59,22.703s. Perfile/globalrangeoverlap checks,globalrowcount,SQLiteintegritypassed; focusedgaia_id_routing_storage_test1passedincl>2^53/resume/overlaptransactionrollback. StillPARTIAL,fullrecordmembership/hydration/aliases/angular/physical/crossmatch/render/nativefullbudgetsunmeasured.

Newtaskownedverify-gaia-routing-projections.py read-onlyverificationFINISHEDPID90405. Forall365indexedfiles freshprojectionSHAchecksandall229418Parquetgroupfooterrowcounts/sourceIDmin/maxmatchedglobalroute; total188594888rows. First/middle/lastgroupofeachfile actualIDsreadlosslessly:3285present-IDroutesand1095within-rangeabsentIDmembershipchecks passed. IDrangeonlyselectscandidategroup,neverassertsexistence. Everycurrentprojectionhash/rangeverified,exactmembershipSAMPLEDnotall188mIDs or152fieldhydration. IndexSHAunchangedstart/end,SQLiteintegritypassed.119.5035s,boundedRSS~71–81MB,localOOM0. gaia-full/routing-projection-verification.json+progressbothPARTIAL_ROUTING_PROJECTION_VERIFIED;workerJSONmarkedFINISHED_VERIFIED_PARTIAL_ROUTING. DoNOTcall90405active. CanextendindexagainlaterbutverificationthenrefersoldpinnedSHA; rerunappropriatecheckafterupdate.

Reporterhooksroutingverification/progressadded;checklistmeasuredartifactandverificationdetailsupdated. Reporterregenerated,py_compiletaskverifier/reporterandgitdiffcheckpassed. NoapplicationDB/nativeUIchanges/spend/deployment. Fullcatalogue/artifacttotalsINCOMPLETE,nohandoff.

SourceworkerscontinueGaia1418latest366files189110522rows;DESI61580last17624465408of22371272640B2101chunks;queuedDESIconversion83278WAITING_FOR_COMPLETE_SOURCE;SDSS81483last584/765runs725058PhotoObjfiles2797683022080PROVIDERmetadataBplus2151210972aux. FullSDSSmetadatawillfinishsoonbutprovider>1TBcustomtransferconstraintunresolved,noemailauthorized/sent. Remote3unitsactive,AllWISE2643files149547562rows72403008950source83053540646candidate5463030678projectionB. RemoteRAM58.65GBavailable168.64GBdiskfree/local177.72GBfree. Spacecraft250metadataandBZCATcandidatejobsDONEpriorturn;doNOTcallactive. NextfinishSDSSinventoryverification,DESIfullsource/audit/queuedconversionwhenready,continuefullGaia/PSC/AllWISEandglobalartifacts.


## 2026-09-10T14:05:03.450489+00:00 — APM documented access routes inspected; full export still unresolved

FullAPMparentPOSS-I/UKSTentryremainsunresolved,notreplacedbyBrightGalaxy/carbon/quasarsubsetsorASPmergedcatalogue. AuthoritativeproviderHTTPSpublichttps://ftp.ast.cam.ac.uk/pub/apmcat/ returns20019303B SHA683d3f43486c852b64cb9e036f7d7640c8b7086c969d0df0dce93358a1b8d31f;parsedactualindexlisttableonlyparent/pub/link,NOcatalogfilelinks. /pub/mike/20022285BSHA0b20814aae15ecfd2df39771c017219d858428885d7ed50dd9d7c30bd25e999e containsclientcodeapmcat.c10769B SHA3546ba792aa1d41f682523b05e9bc06e638b699314ffa3164e426b233ca0ef76 andnotesnotbulkdata. Readcodeonly,noexecution. ClientconstructsPOST/apmcatbin/post-query towww.ast.cam.ac.uk port80;HTTPSroutecurrently404.

Currentproviderhomepagehttps://people.ast.cam.ac.uk/~mike/apmcat/2002117B SHA73eba2e6e51a7a745d5b7927ab2facb9348e3f632c4d84ec34b40874660d912b links exacthttp://apm3.ast.cam.ac.uk/~mike/apmcat/interface.html . Thisworks2001051B SHA165710091530ab4d02f5cd493db6b302ae83dddd3c623906353b35c28c9c56ad,HTMLformPOST/cgi-bin/apmcat/post-query-html requiresRADEC/BOX/CATposs1orukst/EQUINOXb1950orj2000. Roothttpapm3is132Bplaceholder;HTTPSrootfailslocalErrno99butHTTPexactinterfaceworks,soNOTwholeprovideroutage. Noquerysubmitted/masspaging. No documentedcompletefileexportoninspectedroutes. CurrenthomepageJ2000Tycho-2contrastsolderoverviewPPM;actualsourcecalibration/releasepinrequired.

Evidenceapm-access/:rawpages/clientandURL/status/bytes/SHA/date receipts,acquisition-gap.jsonstatusINCOMPLETE_FULL_BULK_ACQUISITION_PATH_UNRESOLVED. Neededactionlocate/obtainprovider-supportedcompleteversionedPOSS-I/UKSTexportwithschemas/coveragemanifests;contactnotauthorized/sent. No claimallpossiblearchivesexhausted/dataabsent/zero-bytecatalogue. Independentverification.jsonfresh6successfulresponsehashes/lengthsplusactualdirectorytable/currentform/legacyclientroutechecks;fullcatalogbytesnull. ReporteroptionalAPMbulk-gapandentryacquisition_gap;checklistdetailedgap. Source/servingtotalsremainunknown.

ActiveGaia1418latest372files192200115rows;DESI61580last17960009728/22371272640B2141chunks;DESIconversion83278WAITING_FOR_COMPLETE_SOURCE;SDSS81483last691/765runs850758PhotoObjfiles3418593929280PROVIDERmetadataBplus2525294367aux. SDSSrun7727temporaryrsyncconnectionrefusedcode10after~minute;automaticretrySUCCEEDEDreceiptpresent,workermovedto7757. Earlier5071/6752stderrhistoricalalsoaccepted,doNOTmarkworkerfailedfromoldstderr. Remote3unitsactive,PSCindex57/92files293236074rows49430249472B;AllWISE2663files150643136rows72925936303source83653248799candidate5501650929projectionB. RemoteRAM58.71GBavailable167.96GBdiskfree/local176.87GBfree. NoDB/newinfra/spend/deploy.

APMread-onlyevidenceverificationpassed;reportregenerated/py_compile/gitdiffcheckpassed. Noapplicationtestsneededforpublicaccessreceipts. Exhaustivecatalogue/artifacttotalsINCOMPLETE,nohandoff. NextfinishSDSS765runmetadataaudit,DESIfullsource/audit/queuedconversionwhenready,continuelargefullsources/indexes. Spacecraft/BZCAT/GaiapartialroutingverificationworkersFINISHEDpreviously,notactive.


## 2026-09-10T14:14:50.440778+00:00 — Complete SDSS file metadata verified; published checksum acquisition active

SDSSlistingworker81483 FINISHEDall765runs. DoNOTcallactive. New taskownedverify-sdss-inventory.py completedindependentreadaudit: everyrawlistingSHA/URL/exit0 verified,allroot765numericruns,noignoredrootfiles,allscientificfilenamesmatchrun/camcol,andallnondatafilesclassified. PROVIDERreportedonly:938046PhotoObjfiles3736373967360B;4590PhotoField2704302720B;765PhotoRun11016000B;765publishedSHA1manifests69771129B. TheseareexactlistingsumsNOTdownloadedscientificsource/data/indexsizeorrowcounts. Rawlistingmetadatameasured72019782B. Verification45.610s,inventorySHAbee130b55e396a1a55b5bb82834948c6ad00f1d68b62a097d1d87987c6a319d9. sdss-run-inventory/verification.jsonandchecksum-file-inventory.jsonsaved. Sourcefullbytes/rows/servingnull.

New scripts/inventory_sdss_checksums.py nowACTIVEPID94476: serialHTTPpublishedchecksumfilesfromhttps://data.sdss.org/sas/dr18/prior-surveys/sdss4-dr17-eboss/photoObj/301/RUN/photoObj_301_RUN.sha1sum,1srequestspacing,3retry5/10s,ownedlock/manifest/atomicreceipts. Eachrawlengthmatcheslistedmetadata,size/SHAreceipt; parserequires40hexSHA1andcanonicalfilenameuniqueandEXACTcompletefilesetforrun(excludingchecksumfileitself),rejectsmalformed/truncated/missing/extra/duplicate. Reusesexisting1000manifestafteroldSHAreceiptverification. Fullmetadataexpected765files69.77MB,943401science+auxfilechecksums; thisisNOT3.74TBscienceacquisition. Provisional20–90minmetadataestimate,notdeadline. WorkerJSONsdss-checksum-worker.json,logsdss-checksum-inventory.log,rootsdss-checksum-inventory/; latest36/765runs34260sourcechecksums2533332ACTUALmetadatabytes,errors[].5parsertests passedinclunlisted/truncated/duplicatefiles; firstactual4+36runsexactmatchedlisting.

IMPORTANT wordingcorrection: pinnedofficialSDSSbulkguide says "please contact the helpdesk" for>1TB toarrangeacustomdata transferbecausefaster/easieronservers. Thisisaproviderrequest/recommendation, NOT evidencepublicfilesinaccessibleoraseparatetechnicalauthorizationrequirement. Earliernotescalleditarequirement/constrainttoo categorically. Currentacquisition-status/checklistcorrected. Publicsciencefilepathworks(firstfilealreadymeasured). Fulltransfermethod/throughputandcapacitystillmustbeestablished; nofullsciencejob/contactsent. DoNOTclaimtechnicalblocksolelyfromthisguidance. Userhasauthorizedlongsafereversiblemeasurementswithoutnewspend; respectprovider-approvedbulkmethods.

ReporterhooksfullSDSSverification/checksummetadata+tableproviderlabelnowshow3.74TBexplicitlyPROVIDER,measuredfullsourcecellremainsnull.52entryledgerassertionschecked. NewstatusFULL_FILE_LISTING_VERIFIED_CHECKSUM_METADATA_ACQUISITION_RUNNING,oldlistingpidNone/newchecksumpid94476. Checklistfullcategorytableandscientificgapsupdated. py_compile/newparser5tests/gitdiffcheckpassed;reportregenerated. Initialcollectorcallhadaccidental4tharg,failedbeforeSSH;correct3argretrycompleted,noeffectonevidence.

OtheractiveGaia1418latest377files194780236rows;DESI61580at18614321152/22371272640B2219chunks;DESIconversion83278WAITING_FOR_COMPLETE_SOURCE. RemotePSCindex58/92files298336074rows50302484480B;AllWISE2678files151435384rows73306051315source84087626558candidate5529638763projectionB;3unitsactive. Remote58.73GBavailableRAM169.03GBfree/local175.93GBfree. NoDB/spend/deploy/newinfra. Allspacecraft/BZCAT/Gaia-routingverificationjobsFINISHEDpriorturns. Exhaustivefullcatalogue/nativeartifacttotalsINCOMPLETE,nohandoff. Nextmonitorchecksum94476,DESIdownloadcompletion+queuedaudit/conversionandlargeglobalindexes,resolvebulkpathswithoutinventedrestrictions.


## 2026-09-10T14:43:06.943696+00:00 — SDSS checksum metadata complete and verified offline

All 765 published SDSS checksum files acquired: 69,771,129 actual metadata bytes, 943,401 science/auxiliary file SHA-1 entries, no errors. Full replay with urllib network disabled rechecked all raw SHA-256 hashes and exact run-listing filename coverage in 93.4995 seconds. Evidence sdss-checksum-inventory/verification.json. Worker 94476 FINISHED; do not call it active. This is metadata only; 3.74 TB PhotoObj remains provider-listed and full science/serving totals null. Reporter now includes verification; checklist updated. Twelve SDSS checksum/listing tests pass; report generation and git diff --check pass.

AllWISE angular feasibility: authoritative https://irsa.ipac.caltech.edu/docs/parquet_catalogs/ confirms healpix_k5 products use nested orders 0/5. Raw documentation 12,689 B SHA085dff51de3b91b48f3c3e0e10716641294261113b1f0a8960ea486ebb839507 retained in allwise-angular-feasibility/. Feasibility JSON lists required per-record membership, cone-boundary reference checks, routing builds, dense-field latency and native rendering measurements. No angular implementation or saving claimed; angular/full serving bytes null. Reporter includes this evidence.

Active Gaia 1418, DESI download 61580, queued DESI full audit/conversion 83278. Three remote units confirmed active: PSC index, AllWISE source, AllWISE packed-ID. Latest collected PSC 59/92 committed files,303436074 rows,51185664000 logical index bytes (partial). AllWISE 2706/12288 verified files,152871924 rows,73990590165 source and84868814280 candidate bytes (partial). Remote free disk159420473344 B, availableRAM58775904256 B; local171.9 GB free at check. DESI still waiting complete checksum before conversion; do not call queued conversion running. All large exhaustive totals INCOMPLETE. No shared DB, spend, infrastructure, deployment or handoff.
