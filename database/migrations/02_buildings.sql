/* 
 * Author: Steven
 * Purpose: Creating Buildings 
 */
create table if not exists buildings (
	id uuid primary key default gen_random_uuid(), --possibly do the abv
	buildings varchar(50) not null unique,
);

/* 
 * Purpose: Possibly do the floors here or have it in its own?
 */


