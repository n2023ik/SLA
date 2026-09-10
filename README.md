# SLA Guardian

Build a full-stack web application called:

"Quick Commerce SLA Diagnosis and Workforce Bottleneck Analytics System"

PROJECT PURPOSE:

The system is designed for quick-commerce operations where orders must be delivered within a promised SLA. The application must monitor each order through:

Order Created → Picking → Packing → Dispatch → Delivery

The key purpose is not only to detect SLA breaches, but to identify:

1. Which stage caused the delay

2. The probable root cause

3. Whether the cause is related to manpower, picker, packer, zone, inventory, packing station, or rider/dispatch

4. Whether the same problem is recurring

5. In which zone/area the problem happens

6. During which hour/shift/day it happens

7. Which employees repeatedly show delays compared with comparable workloads

8. What corrective action should be recommended

IMPORTANT:

Do not build a generic analytics dashboard. Build the application around operational diagnosis.

TECHNICAL REQUIREMENTS:

- React frontend

- PostgreSQL database

- Backend API architecture

- Clean modular code

- Responsive desktop dashboard

- Use realistic mock data initially

- Keep the architecture ready for future real-time event ingestion

DATABASE TABLES:

1. orders

- id

- order_id

- store_id

- created_at

- promised_delivery_time

- delivered_at

- status

- total_items

- customer_distance_km

2. order_events

- id

- order_id

- event_type

- timestamp

- employee_id

- employee_role

- zone_id

- station_id

- notes

event_type values:

- ORDER_CREATED

- PICKING_STARTED

- PICKING_COMPLETED

- PACKING_STARTED

- PACKING_COMPLETED

- DISPATCHED

- DELIVERED

3. workforce

- id

- employee_id

- name

- role

- zone_id

- shift

- active

- joining_date

role values:

- PICKER

- PACKER

- RIDER

4. zones

- id

- zone_id

- zone_name

- store_id

5. inventory

- id

- sku_id

- zone_id

- stock_level

- reorder_threshold

6. packing_stations

- id

- station_id

- store_id

- status

- current_queue_length

7. sla_metrics

- id

- order_id

- pick_start_delay

- pick_duration

- pack_duration

- dispatch_wait

- delivery_duration

- total_duration

- sla_status

- breach_stage

- created_at

8. diagnoses

- id

- order_id

- stage

- root_cause

- confidence_score

- recommended_action

- created_at

- resolved

9. workforce_metrics

- id

- employee_id

- role

- date

- orders_handled

- average_stage_time

- delay_count

- sla_breach_count

- productivity_score

10. bottleneck_events

- id

- store_id

- zone_id

- stage

- time_bucket

- occurrence_count

- average_delay

- root_cause

- severity

DASHBOARD PAGES:

PAGE 1 — Operations Overview

Show:

- SLA adherence %

- Total orders

- Orders on track

- Orders at risk

- SLA breached orders

- Average total delivery time

- Average pick time

- Average pack time

- Average dispatch time

PAGE 2 — Live Orders

Columns:

- Order ID

- Store

- Current Stage

- Elapsed Time

- SLA Remaining

- Picker/Packer/Rider

- Zone

- Risk Status

- Diagnosis

- Recommended Action

Use statuses:

- ON TRACK

- AT RISK

- BREACHED

PAGE 3 — Diagnosis

For each risky/breached order show:

- order ID

- delayed stage

- actual time

- expected time

- root cause

- confidence

- supporting evidence

- recommended action

PAGE 4 — Workforce Analytics

Show separate analytics for:

- Pickers

- Packers

- Riders

Metrics:

- Orders handled

- Average processing time

- Delay count

- SLA breach count

- Productivity score

- Repeat delay count

Allow filtering by:

- employee

- role

- zone

- shift

- date

IMPORTANT:

Do not label an employee as "bad" simply because they have delays.

Compare employees against similar workloads, item counts, zones, and shifts.

Use terms like "performance anomaly" or "recurring delay pattern."

PAGE 5 — Bottleneck Analysis

Show:

- Zone-wise bottlenecks

- Hour-wise bottlenecks

- Shift-wise bottlenecks

- Stage-wise bottlenecks

- Picker-related delays

- Packer-related delays

- Dispatch delays

Charts:

- delay frequency by zone

- delay frequency by hour

- average stage time

- SLA breaches by stage

- top recurring bottlenecks

PAGE 6 — Recommendations

Show actionable recommendations such as:

- Reallocate picker

- Add picker during peak period

- Prioritise order for packing

- Open additional packing station

- Reassign rider

- Investigate inventory/location issue

PAGE 7 — Historical Analysis

Allow selection of:

- today

- last 7 days

- last 30 days

Show recurring patterns:

- same zone

- same hour

- same shift

- same stage

- repeated employee anomaly

- repeated packing station congestion

PAGE 8 — Order Details

For one order, show a timeline:

Created

↓

Picking Started

↓

Picking Completed

↓

Packing Started

↓

Packing Completed

↓

Dispatched

↓

Delivered

Display expected vs actual time at each stage.

DIAGNOSTIC RULES:

Implement the diagnosis as a separate backend service/module.

Initial rules:

1. If order-to-pick-start exceeds threshold:

   possible causes = picker assignment delay / manpower shortage

2. If picking duration exceeds threshold:

   inspect picker workload, zone congestion, item count, and inventory location

3. If packing duration exceeds threshold:

   inspect packer workload and packing station queue

4. If dispatch wait exceeds threshold:

   inspect rider availability, rider distance, and dispatch queue

5. If many orders in the same zone are delayed:

   classify as zone-level bottleneck

6. If delays increase sharply during a specific hour:

   classify as time-based capacity bottleneck

7. If one employee repeatedly performs significantly worse than comparable employees:

   classify as performance anomaly, not automatic blame

8. If multiple employees are overloaded simultaneously:

   classify as manpower/capacity issue

Create a diagnosis result with:

stage

root_cause

evidence

confidence_score

recommended_action

IMPORTANT UI:

Use a professional operations-control style.

Make risky orders visually prominent.

Do not overcrowd the dashboard.

Use cards, tables, charts, filters, and clear status indicators.

SEED DATA:

Generate at least:

- 1,000 orders

- 20+ pickers

- 10+ packers

- 15+ riders

- 5 zones

- 3 shifts

- 10+ packing stations

Create realistic patterns so the analytics are meaningful:

- some delays caused by manpower shortage

- some delays caused by a particular zone

- some delays concentrated in evening hours

- some packing station bottlenecks

- some individual performance anomalies

- some normal orders

Do NOT use random data only. Create correlated patterns that the diagnosis engine can actually detect.

Build the database schema, backend APIs, frontend pages, seed data, and initial diagnosis module.

Keep the diagnosis rules modular so they can be changed later.

This project was built with SLA.

## Build with SLA



- **Ship faster**: describe what you want to build and SLA handles the code.
- **Stay in sync**: every change made in SLA is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into SLA ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
