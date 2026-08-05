import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node src/set-auth-user-password.js <email> <password>");
  process.exit(1);
}

if (password.length < 6) {
  console.error("Password must be at least 6 characters.");
  process.exit(1);
}

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  console.error("Supabase URL/service role key is missing in backend/.env.");
  process.exit(1);
}

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function findUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 100;

  while (page < 100) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) throw error;

    const user = data.users.find((item) => item.email?.toLowerCase() === targetEmail.toLowerCase());
    if (user) return user;
    if (data.users.length < perPage) return null;
    page += 1;
  }

  return null;
}

async function main() {
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    const { error } = await supabase.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true
    });

    if (error) throw error;
    console.log(`Password updated for ${email}.`);
    return;
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) throw error;
  console.log(`Confirmed user created for ${email}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
