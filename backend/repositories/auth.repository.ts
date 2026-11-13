import { supabase } from "../configs/supabase.js";

export interface NewUser {
  name: string;
  email: string;
  password: string;
  role: "admin" | "employee";
  status: "active" | "inactive";
}

export interface StoredUser extends NewUser {
  id: string;
}

export async function createUser(newUser: NewUser): Promise<StoredUser> {
  const { data, error } = await supabase
    .from("ec_users")
    .insert(newUser)
    .select("id,name,email,password,role,status")
    .single();
  if (error) throw new Error(`Erro ao criar utilizador: ${error.message}`);
  return data as StoredUser;
}

export async function getUserByEmail(email: string): Promise<StoredUser | null> {
  const { data, error } = await supabase
    .from("ec_users")
    .select("id,name,email,password,role,status")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`Erro ao procurar utilizador: ${error.message}`);
  return data as StoredUser | null;
}
