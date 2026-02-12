"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { 
  User, 
  Mail, 
  Phone, 
  Bell, 
  Lock, 
  Eye, 
  EyeOff, 
  Shield,
  LogOut,
  Trash2,
  Save
} from "lucide-react";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "notifications" | "privacy" | "account">("profile");

  // Profile form state
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [mobile, setMobile] = useState(user?.mobile || "");

  // Notification settings
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [callNotifications, setCallNotifications] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Privacy settings
  const [profileVisibility, setProfileVisibility] = useState<"everyone" | "members" | "private">("members");
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setMobile(user.mobile || "");
    }
  }, [user]);

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      // TODO: Implement API call to update profile
      // await fetch('/api/user/update', { method: 'POST', body: JSON.stringify({ name, email, mobile }) });
      console.log("Saving profile:", { name, email, mobile });
      alert("Profile updated successfully!");
    } catch (err) {
      console.error("Failed to update profile:", err);
      alert("Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "privacy", label: "Privacy", icon: Shield },
    { id: "account", label: "Account", icon: Lock },
  ] as const;

  return (
    <div className="space-y-8 max-w-4xl">
      <header>
        <h2 className="text-3xl font-light tracking-tight text-white">Settings</h2>
        <p className="text-zinc-500 mt-2">Manage your account and preferences</p>
      </header>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-white text-black"
                : "bg-zinc-900/40 text-zinc-400 hover:text-white hover:bg-zinc-800/60 border border-zinc-800"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div className="space-y-6">
          {/* Avatar Section */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-medium text-white mb-4">Profile Picture</h3>
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center border-2 border-zinc-700">
                {user?.avatarConfig?.image ? (
                  <img
                    src={user.avatarConfig.image}
                    alt={user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-bold text-white">
                    {user?.name?.[0]?.toUpperCase() || "U"}
                  </span>
                )}
              </div>
              <div>
                <p className="text-sm text-zinc-400">Your profile avatar</p>
                <p className="text-xs text-zinc-600 mt-1">Contact support to change your profile picture</p>
              </div>
            </div>
          </div>

          {/* Personal Info */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 backdrop-blur-sm space-y-5">
            <h3 className="text-lg font-medium text-white mb-4">Personal Information</h3>
            
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Full Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-2">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
                  placeholder="your@email.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-2">Mobile Number</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>

            <button
              onClick={handleSaveProfile}
              disabled={loading}
              className="w-full mt-4 px-6 py-3 bg-white text-black font-medium rounded-xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === "notifications" && (
        <div className="space-y-4">
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-medium text-white mb-6">Notification Preferences</h3>
            
            <div className="space-y-5">
              <div className="flex items-center justify-between py-3 border-b border-zinc-800/50">
                <div>
                  <p className="text-white font-medium">Email Notifications</p>
                  <p className="text-sm text-zinc-500">Receive updates via email</p>
                </div>
                <button
                  onClick={() => setEmailNotifications(!emailNotifications)}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    emailNotifications ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    emailNotifications ? "translate-x-8" : "translate-x-1"
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-zinc-800/50">
                <div>
                  <p className="text-white font-medium">Call Notifications</p>
                  <p className="text-sm text-zinc-500">Get notified of incoming calls</p>
                </div>
                <button
                  onClick={() => setCallNotifications(!callNotifications)}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    callNotifications ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    callNotifications ? "translate-x-8" : "translate-x-1"
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="text-white font-medium">Sound Effects</p>
                  <p className="text-sm text-zinc-500">Enable notification sounds</p>
                </div>
                <button
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    soundEnabled ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    soundEnabled ? "translate-x-8" : "translate-x-1"
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Tab */}
      {activeTab === "privacy" && (
        <div className="space-y-4">
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-medium text-white mb-6">Privacy Settings</h3>
            
            <div className="space-y-5">
              <div>
                <label className="block text-white font-medium mb-3">Profile Visibility</label>
                <div className="space-y-2">
                  {[
                    { value: "everyone", label: "Everyone", desc: "Anyone can view your profile" },
                    { value: "members", label: "Members Only", desc: "Only community members" },
                    { value: "private", label: "Private", desc: "Only you can see your profile" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setProfileVisibility(option.value as any)}
                      className={`w-full text-left p-4 rounded-xl border transition-all ${
                        profileVisibility === option.value
                          ? "bg-zinc-800 border-zinc-700"
                          : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <p className="text-white font-medium">{option.label}</p>
                      <p className="text-sm text-zinc-500">{option.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-zinc-800/50 pt-5">
                <div>
                  <p className="text-white font-medium">Show Online Status</p>
                  <p className="text-sm text-zinc-500">Let others see when you're online</p>
                </div>
                <button
                  onClick={() => setShowOnlineStatus(!showOnlineStatus)}
                  className={`relative w-14 h-7 rounded-full transition-colors ${
                    showOnlineStatus ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    showOnlineStatus ? "translate-x-8" : "translate-x-1"
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account Tab */}
      {activeTab === "account" && (
        <div className="space-y-4">
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-medium text-white mb-6">Account Actions</h3>
            
            <div className="space-y-4">
              <button
                onClick={logout}
                className="w-full flex items-center justify-between p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl hover:border-yellow-600/50 hover:bg-yellow-600/5 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center group-hover:bg-yellow-500/20 transition-colors">
                    <LogOut className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-medium">Sign Out</p>
                    <p className="text-sm text-zinc-500">Sign out from this device</p>
                  </div>
                </div>
              </button>

              <button className="w-full flex items-center justify-between p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl hover:border-red-600/50 hover:bg-red-600/5 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                    <Trash2 className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-medium">Delete Account</p>
                    <p className="text-sm text-zinc-500">Permanently delete your account</p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-medium text-white mb-4">Account Information</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-zinc-800/50">
                <span className="text-zinc-400">Account Status</span>
                <span className="text-white capitalize">{user?.status || "Active"}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-zinc-800/50">
                <span className="text-zinc-400">Role</span>
                <span className="text-white capitalize">{user?.role || "User"}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-zinc-400">Member Since</span>
                <span className="text-white">
                  {user?.createdAt 
                    ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                    : "Recently"
                  }
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
