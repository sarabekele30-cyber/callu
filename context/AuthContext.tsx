"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface User {
  _id: string;
  name: string;
  email: string;
  mobile: string;
  status: 'pending' | 'approved' | 'rejected';
  role: 'user' | 'admin';
  avatarConfig: {
    image?: string;
    color: string;
  };
}

interface AuthContextType {
  user: User | null;
  login: (emailOrId: string, password?: string, isAdmin?: boolean) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: async () => false,
  logout: () => {},
  isLoading: true,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check localStorage for persisted user
    const storedUser = localStorage.getItem("callu_user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setIsLoading(false);
  }, []);

  const login = async (emailOrId: string, password?: string, isAdmin?: boolean) => {
    try {
      const body = isAdmin 
        ? { adminId: emailOrId, password }
        : { email: emailOrId };

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        localStorage.setItem("callu_user", JSON.stringify(data.user));
        return true;
      } else {
        const error = await res.json();
        toast.error(error.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("callu_user");
    router.push("/");
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
