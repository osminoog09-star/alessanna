# SALON CRM ARCHITECTURE

## ROLES

* owner
* admin
* manager
* worker

## STAFF

* id
* name
* phone
* role
* is_active
* work_type (percentage | rent)
* percent_rate
* rent_per_day

## CLIENTS

* id
* name
* phone
* created_at

## APPOINTMENTS

* id
* client_id
* created_at

## APPOINTMENT_SERVICES

* id
* appointment_id
* service_id
* staff_id
* start_time
* end_time

## SERVICES

* id
* name
* price
* duration
* category_id

## SERVICE_CATEGORIES

* id
* name

## STAFF_SCHEDULE

* staff_id
* day_of_week
* start_time
* end_time

## STAFF_TIME_OFF

* staff_id
* start_time
* end_time
* time_off_type (sick_leave | day_off | manual_block)

## STAFF_WORK_DAYS

* staff_id
* date
* is_working

## LOGIC

* One appointment = one visit
* One visit = multiple services
* Calendar uses appointment_services
* Clients linked by phone
* Finance:

  * percentage -> percent_rate
  * rent -> rent_per_day x work_days
