/* 
 * Author: Steven
 * Purpose: Creating Users 
 */
create table if not exists users (
	id uuid primary key default gen_random_uuid(),
	username varchar(50) not null unique,
	user_pass varchar(100) not null,
	created_at timestamp default current_timestamp
);

/* 
 * Purpose: Creating Users classes.
 */

create table if not exists user_classes(
	id bigint generated always as identity primary key,
	user_id	uuid not null references users(id) on delete cascade,
	created_at timestamp default current_timestamp
);