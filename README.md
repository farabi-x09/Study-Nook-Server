StudyNook – Library Study Room Booking
Live Site URL: https://study-nook-pi.vercel.app

StudyNook is a full‑stack web application designed for students and library users to easily find, list, and reserve private study rooms. Whether you need a quiet zone for deep work or a collaboration bay equipped with a whiteboard and projector, StudyNook simplifies the process while ensuring a secure and conflict-free booking experience.

Features
Conflict-Free Booking System: Automatically detects overlapping time slots to prevent double-booking of any study room.
Secure Authentication: Utilizes JSON Web Tokens (JWT) stored safely in HTTP-only cookies to protect user sessions and private routes.
Dynamic Search & Filtering: Instantly search for rooms by name or filter down by specific amenities and pricing to find the perfect focus space.
Complete Dashboard: Registered users can effortlessly manage their own listings, track their upcoming study sessions, and cancel future reservations.
Responsive & Modern Design: Built with Next.js, Framer Motion, and Tailwind CSS to ensure a beautiful, fast, and seamless experience across mobile, tablet, and desktop.
Technologies Used
Frontend: Next.js (App Router), React, Tailwind CSS, Framer Motion, HeroUI
Backend: Node.js, Express, MongoDB (MongoDB Driver)
Authentication: Better-Auth, JSON Web Tokens (jsonwebtoken)
Security: HTTP-Only Cookies, CORS configuration
Setup Instructions
Clone the repository and run npm install in both the client and server directories.
Set up your .env files with MONGODB_URI, JWT_SECRET, and BETTER_AUTH_SECRET.
Run npm run dev in both directories to start the frontend and backend servers simultaneously.
