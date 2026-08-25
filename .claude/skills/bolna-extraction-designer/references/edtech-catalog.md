# Ed-Tech Extraction Catalog (v1, 34 extractions)

Full ready-to-submit JSON is in `../assets/edtech_dispositions/` (one file per category, schema-correct per `field-mapping.md`, missing only `agent_id`). This file is the human-readable index plus the design judgment behind the pack — useful for building an analogous pack in a different vertical, not just for reusing ed-tech verbatim.

Ed-Tech-specific categories (would need adaptation for a non-ed-tech vertical): `User_Data`, `Scheduling_Next_Steps`, `Call_Success`.
Generic categories (reusable as-is for any voice-agent use case — cart recovery, recruitment, healthcare, collections): `Feedback_QA`, `Referral`.

## User_Data (13) — `user_data.json`

CRM/profile data: who the user is, their academic context.

| Name | Answer type |
|---|---|
| `customer_name` | Free Text |
| `customer_phone_number` | Free Text |
| `customer_email` | Free Text (Email) |
| `preferred_contact_channel` | Pre-defined: Call, WhatsApp, Email, SMS, No_Preference, Do_Not_Contact, Not_Specified |
| `contact_validity_status` | Pre-defined, priority-rule: Wrong_Number, Do_Not_Contact, Valid_Contact, Not_Specified |
| `academic_score` | Free Text |
| `highest_qualification` | Pre-defined: Class_10_or_Below … PhD_Completed, Other, Not_Specified |
| `exam_interest` | Pre-defined: Yes, No, Maybe, Not_Specified |
| `exam_taken_type` | Pre-defined: JEE, NEET, CUET, CAT, MAT, XAT, GMAT, GRE, GATE, CLAT, NID, NIFT, UCEED, CEED, SAT, IELTS, TOEFL, State_Entrance_Exam, Institute_Specific_Exam, Other, Not_Specified |
| `program_or_stream_interest` | Pre-defined: Computer_Science, AI_ML, Data_Science, Cybersecurity, Electronics_Communication, Mechanical, Civil, Management, Commerce, Design, Law, Medical, Arts_Humanities, Other, Not_Specified |
| `hostel_requirement` | Pre-defined: Yes, No, Not_Specified |
| `program_delivery_mode` | Pre-defined: Online, Offline, Hybrid, Study_Abroad, Distance_Learning, Other, Not_Specified |
| `respondent_type` | Pre-defined: Student, Parent_Guardian, Sibling_Relative, Friend, Counselor_or_Agent, Other, Not_Specified |

## Scheduling_Next_Steps (3) — `scheduling_next_steps.json`

| Name | Answer type |
|---|---|
| `callback` | Free Text (Timestamp) + Pre-defined Yes/No — resume of *this* conversation |
| `future_scheduling` | Free Text (Timestamp) + Pre-defined Yes/No — a *new* engagement (counselor/demo/admission) |
| `follow_up_interest` | Pre-defined Yes/No — open to future contact, no confirmed time |

## Call_Success (8) — `call_success.json`

| Name | Answer type |
|---|---|
| `admission_interest` | Pre-defined: Yes, No, Maybe, Not_Specified |
| `qualification_status` | Pre-defined: Qualified, Not_Qualified, Not_Sure |
| `admission_timeline` | Pre-defined: Immediate, Short_Term, Medium_Term, Long_Term, Undecided, Not_Specified |
| `call_outcome` | Pre-defined, 11-value priority-rule classifier (synthesis archetype) |
| `program_interest` | Pre-defined: Interested, Not_Interested, Maybe, Needs_More_Info, Not_Specified |
| `application_status` | Pre-defined (nested) — Layer 1 state, Layer 2 issue type under Facing_Issue |
| `scholarship_or_financial_assistance` | Pre-defined (nested) — Layer 1 Yes/No, Layer 2 assistance type under Yes |
| `sentiment_temperature` | Pre-defined: Hot, Warm, Neutral, Cold, Negative |

## Feedback_QA (4, generic) — `feedback_qa.json`

| Name | Answer type |
|---|---|
| `customer_feedback_and_rating` | Free Text + Pre-defined 1-5/Not_Provided |
| `objection_type` | Pre-defined: Price, Timing, Not_Interested, Trust, Eligibility, Location, Family_Approval, Already_Enrolled, Needs_More_Info, Other, NA |
| `escalation_required` | Pre-defined Yes/No |
| `unanswered_queries` | Free Text (list) |

## Referral (6, generic) — `referral.json`

| Name | Answer type |
|---|---|
| `referral_intent` | Pre-defined: Yes, No, Maybe, Already_Referred, NA |
| `referral_status` | Pre-defined: Shared, Will_Share, Already_Shared, Not_Interested, NA |
| `referral_name` | Free Text |
| `referral_phone_number` | Free Text |
| `referral_email` | Free Text (Email) |
| `referral_relationship` | Free Text + Pre-defined: Friend, Sibling, Parent, Colleague, Student, Other, Not_Specified |

## Consolidation notes (design judgment, reusable across verticals)

**Callback vs. Future Scheduling.** Callback = resume *this* conversation later (user's busy, can't talk now). Future Scheduling = book a *next-step* engagement, possibly with a different person (counselor, demo). Different downstream actions — always track separately, never merge.

**Raw data vs. funnel signal.** Academic score, qualification, respondent type, hostel need, stream interest describe *who the user is*. Qualification status, call outcome, sentiment, application status, scholarship need describe *where the lead is in the funnel*. Keep this distinction in mind when a user asks for "one big extraction" — usually they actually want one of each kind, not a single field trying to do both jobs.

**Nested dispositions** produce Layer 1 + Layer 2 in one API call via `sub_options` — use when downstream consumers want the sub-category without a second round trip, but only nest 2 layers deep in practice (3 is technically supported, rarely useful).

**Free Text + Pre-defined coexistence** has two sub-patterns: conditional data capture (Pre-defined Yes/No gates whether Free Text captures detail — `callback`, `future_scheduling`) and verdict + reasoning (Pre-defined is the verdict, Free Text is why — `customer_feedback_and_rating`, `referral_relationship`). The two outputs are independent per the API — the `question` text must scope both behaviors in clearly separated sections ("For the Pre-defined output: ... For the Free Text output: ...").

**Priority-ordered classifiers** (`call_outcome`, `contact_validity_status`) exist because naive "pick whichever matches" logic breaks when several values could legitimately match the same transcript — operational blockers (Wrong_Number, Do_Not_Contact) must outrank sales-funnel outcomes (Interested, Converted) or a wrong-number call gets miscounted as a cold lead.
