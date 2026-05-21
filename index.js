const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet } = require("jose-cjs");
dotenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const port = process.env.PORT;

app.use(
  cors({

    origin: [`${process.env.CLIENT_URL}`],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.error("JWT verification failed:", error);
    return res.status(401).json({ message: "forbidden" });
  }
};


function sanitize(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([key]) => !key.startsWith("$"))
        .map(([key, value]) => [key, sanitize(value)]),
    );
  }
  return obj;
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {


    const db = client.db("studynook");
    const roomCollection = db.collection("rooms");
    const bookingCollection = db.collection("bookings");

    app.get("/room", async (req, res) => {
      const { search, amenities, minRate, maxRate, sort, limit, email } =
        req.query;

      // Build filter query
      const query = {};

      // Filter by owner email (for My Listings page)
      if (email) {
        query.userEmail = email;
      }

      // Search by name (case-insensitive partial match)
      if (search && search.trim()) {
        query.name = { $regex: search.trim(), $options: "i" };
      }

      // Filter by amenities — room must have ALL selected amenities
      if (amenities) {
        const amenityList = Array.isArray(amenities)
          ? amenities
          : amenities.split(",").filter(Boolean);
        if (amenityList.length > 0) {
          query.amenities = { $all: amenityList };
        }
      }

      // Filter by hourly rate range
      if (minRate || maxRate) {
        query.hourlyRate = {};
        if (minRate) query.hourlyRate.$gte = parseFloat(minRate);
        if (maxRate) query.hourlyRate.$lte = parseFloat(maxRate);
      }

      // Sorting
      const limitNum = limit ? parseInt(limit) : 0;

      let result;

      if (sort === "most-booked") {
        // Pipeline-based $lookup: convert room _id to string so it matches
        // the string roomId stored in booking documents
        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: "bookings",
              let: { roomIdStr: { $toString: "$_id" } },
              pipeline: [
                { $match: { $expr: { $eq: ["$roomId", "$$roomIdStr"] } } },
              ],
              as: "bookingDocs",
            },
          },
          { $addFields: { bookingCount: { $size: "$bookingDocs" } } },
          { $sort: { bookingCount: -1, _id: -1 } },
          { $project: { bookingDocs: 0, bookingCount: 0 } },
          ...(limitNum > 0 ? [{ $limit: limitNum }] : []),
        ];
        result = await roomCollection.aggregate(pipeline).toArray();
      } else if (sort === "price-low" || sort === "price-high") {
        // Use $toDouble so legacy rooms with hourlyRate stored as a string
        // still sort numerically instead of lexicographically
        const sortDir = sort === "price-low" ? 1 : -1;
        const pipeline = [
          { $match: query },
          { $addFields: { hourlyRateNum: { $toDouble: "$hourlyRate" } } },
          { $sort: { hourlyRateNum: sortDir, _id: -1 } },
          { $project: { hourlyRateNum: 0 } },
          ...(limitNum > 0 ? [{ $limit: limitNum }] : []),
        ];
        result = await roomCollection.aggregate(pipeline).toArray();
      } else {
        // Default / 'latest': newest first
        result = await roomCollection
          .find(query)
          .sort({ _id: -1 })
          .limit(limitNum)
          .toArray();
      }

      res.json(result);
    });

    app.post("/room", verifyToken, async (req, res) => {
      const roomData = sanitize(req.body);
      const result = await roomCollection.insertOne(roomData);
      res.json(result);
    });

    app.get("/room/:id", async (req, res) => {
      const { id } = req.params;
      const result = await roomCollection.findOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    app.patch("/room/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      // Ownership check: only the room owner can update
      const room = await roomCollection.findOne({ _id: new ObjectId(id) });
      if (!room) return res.status(404).json({ message: "Room not found" });
      if (room.userEmail !== req.user.email) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const updatedData = sanitize(req.body);
      const result = await roomCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );
      res.json(result);
    });

    app.delete("/room/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      // Ownership check: only the room owner can delete
      const room = await roomCollection.findOne({ _id: new ObjectId(id) });
      if (!room) return res.status(404).json({ message: "Room not found" });
      if (room.userEmail !== req.user.email) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await roomCollection.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    app.get("/booking", verifyToken, async (req, res) => {
      const { email } = req.query;
      // Users can only view their own bookings
      const queryEmail = email || req.user.email;
      if (queryEmail !== req.user.email) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await bookingCollection
        .find({ userEmail: queryEmail })
        .sort({ date: -1 })
        .toArray();
      res.json(result);
    });

    app.post("/booking", verifyToken, async (req, res) => {
      const bookingData = sanitize(req.body);
      const { roomId, date, startTime, endTime } = bookingData;

      // 1. Fetch existing non-cancelled bookings for this room on the same date
      const existingBookings = await bookingCollection
        .find({
          roomId,
          date,
          status: { $ne: "cancelled" },
        })
        .toArray();

      // 2. Check for overlaps
      // Two time intervals [startA, endA) and [startB, endB) overlap if:
      // startA < endB AND endA > startB
      const isOverlapping = existingBookings.some((booking) => {
        return startTime < booking.endTime && endTime > booking.startTime;
      });

      if (isOverlapping) {
        return res.status(400).json({
          error:
            "This room is already booked for the selected time slot. Please choose a different time.",
        });
      }

      // 3. If no overlap, proceed with booking
      const result = await bookingCollection.insertOne(bookingData);

      // Increment booking count on the room
      await roomCollection.updateOne(
        { _id: new ObjectId(roomId) },
        { $inc: { bookingCount: 1 } },
      );

      res.json(result);
    });

    app.patch("/booking/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      // Ownership check: only the booking owner can modify
      const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
      if (!booking) return res.status(404).json({ message: "Booking not found" });
      if (booking.userEmail !== req.user.email) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const updatedData = sanitize(req.body);
      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );
      res.json(result);
    });

    app.delete("/booking/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      // Ownership check: only the booking owner can delete
      const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
      if (!booking) return res.status(404).json({ message: "Booking not found" });
      if (booking.userEmail !== req.user.email) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await bookingCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    app.get("/booking/:userId", verifyToken, async (req, res) => {
      const { userId } = req.params;
      // Users can only view their own bookings
      if (userId !== req.user.id && userId !== req.user.sub) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await bookingCollection.find({ userId: userId }).toArray();
      res.json(result);
    });

    // Send  ping to confirm a successful connnection
    // comment this for deploy
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // sob somy aita comment korte hoybo
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("wlc farabi,s World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

module.exports = app;
