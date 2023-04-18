const User = require("../models/users");
const Bill = require("../models/bill");
const Event = require("../models/event");
const fs = require("fs");
const csv = require("csv-string");
const auth = require("../middleware/auth");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const { validationResult } = require("express-validator");
const { isValidObjectId } = require("mongoose");
const HttpError = require("../models/http-error");

dotenv.config();

const connection = mongoose.connection;

let bucket;
connection.once("open", () => {
  bucket = new mongoose.mongo.GridFSBucket(connection, {
    bucketName: "resources",
    chunkSizeBytes: 1048576,
  });
});
const getUsers = async (req, res, next) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));
  User.find({ isVerified: true }, " -__v")
    .then((users) => {
      return res.status(200).json({ users });
    })
    .catch((e) => {
      return res.status(500).json({ message: "Cannot find users" });
    });
};

//Get Single User

const getUser = (req, res, next) => {
  const userId = req.params.uid.replace(/\s+/g, " ").trim();
  User.findById(
    userId,
    " email first_name last_name phone_number company isVerified role sector dob"
  )
    .then((user) => {
      if (!user) return res.status(404).json({ message: "No user found" });
      return res.status(201).json(user);
    })
    .catch(() => {
      return res
        .status(500)
        .json({ message: "Something went wrong , Please try again" });
    });
};

const exportData = async (req, res, next) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));

    User.find({}, "first_name last_name address phone_number employer years_of_exp membership_type role email")
    .then((data) => {
      const headers = Object.keys(data[0].toObject());
      const csvData = csv.stringify([
        headers,
        ...data.map((item) => Object.values(item.toObject())),
      ]);

      fs.writeFileSync("users.csv", csvData);
      res.download("users.csv");
    })
    .catch((error) => {
      res.status(500).json({ error });
    });
};

const allFiles = (req, res) => {
  if (req.userData.role === "user")
    return res
      .status(403)
      .json({ message: "You are unauthorized for this operation" });

  if (!isValidObjectId(req.userData.userId))
    return res.status(404).json({ message: "Invalid Request" });

  User.find({}, " first_name last_name resource_library")
    .populate({ path: "resource_library", select: "name path" })

    .then((user) => {
      if (!user) return res.status(400).json({ message: "No User Found" });

      return res.status(200).json(user);
    })
    .catch((e) => {
      return res
        .status(500)
        .json({ message: "Something went wrong, Please try again", err: e });
    });
};
// const getUserFiles = async (req, res) => {
//   if (req.userData.role === "user")
//   return res
//     .status(403)
//     .json({ message: "You are unauthorized for this operation" });
//   const cursor = bucket.find({ "metadata.uploadedBy": req.params.uid });
//   if (!cursor) return res.status(404).json({ message: "User not found" });
//   const filesMetadata = await cursor.toArray();
//   res.json(filesMetadata);
// };

const upload = async (req, res) => {
  if (req.userData.role === "user")
    return res
      .status(403)
      .json({ message: "You are unauthorized for this operation" });
  if (req.fileValidationError) {
    return res.status(422).json({ message: req.fileValidationError });
  }
  if (!req.files || req.files.length <= 0)
    return res.status(422).json({ message: "No Image Provided" });
  // if (!isValidObjectId(req.userData.userId))
  //   return res.status(404).json({ message: "Invalid UserId" });

  res.status(201).json({ message: "File Uploaded Sucessfully" });
};

const createBills = async (req, res, next) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));

  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(400).json({ message: message });
  }
  let existingUser;
  let groupUsers;

  const { bill_name, bill_amount, individual, group } = req.body;

  if (!individual && !group)
    return res.json({ message: "Bill is not assigned to anyone." });

  if (individual) {
    if (!isValidObjectId(individual))
      return res.status(404).json({ message: "User not found" });
    try {
      existingUser = await User.findOne({ _id: individual, isVerified: true });
    } catch (err) {
      return res
        .status(500)
        .json({ message: " Something went wrong. Please try again" });
    }

    if (!existingUser)
      return res.status(422).json({
        message: `User with id ${individual} not found or user is yet to be verified`,
      });
  }

  try {
    if (group) {
      groupUsers = await User.find({
        membership_type: { $in: group },
        isVerified: true,
      });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ message: " Something went wrong. Please try again", error: err });
  }
  const checkUser = existingUser ? existingUser.id : null;

  if (existingUser) {
    const bill = Bill({
      bill_name,
      bill_amount,
      individual: checkUser,
    });
    try {
      await bill.save();
    } catch (err) {
      return res.json({ message: "Something went wrong", e: err });
    }
    existingUser.bills.push(bill);
    await existingUser.save();
  }
  if (group && groupUsers.length > 0) {
    try {
      const promises = groupUsers.map(async (user) => {
        const bill = Bill({
          bill_name,
          bill_amount,

          individual: user.id,
        });
        let b = await bill.save();
        user.bills.push(b);
        user.save();
      });
      await Promise.all(promises);
    } catch (e) {
      return res
        .status(500)
        .json({ message: "Error in assigning bills to group", err: e });
    }
  }

  if (!existingUser && groupUsers.length === 0)
    return res.json({ message: "Bill is not assigned to anyone!." });

  res.status(201).json({ message: "Bill assigned sucessfully" });
};
const usersBills = async (req, res) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));
  try {
    const bills = await Bill.find(
      {},
      "  bill_name bill_amount status createdAt"
    )
      .populate({
        path: "individual",
        select: "first_name last_name ",
      })
      .exec();
    res.json(bills);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};
const getBill = async (req, res) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));

  try {
    const bill = await Bill.findById(
      req.params.id,
      "  bill_name bill_amount status createdAt"
    )
      .populate({
        path: "individual",
        select: "first_name last_name ",
      })
      .exec();
    if (!bill) {
      return res.status(404).json({ error: "Bill not found" });
    }
    res.json(bill);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

const getExistingBill = async (req, res, next) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));

  try {
    const bill = await Bill.find(
      { status: "unpaid" },
      "  bill_name bill_amount status createdAt"
    )
      .populate({
        path: "individual",
        select: "first_name last_name ",
      })
      .exec();
    res.json(bill);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

const getPaidBills = async (req, res, next) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));

  try {
    const bill = await Bill.find(
      { status: "paid" },
      "  bill_name bill_amount status createdAt"
    )
      .populate({
        path: "individual",
        select: "first_name last_name ",
      })
      .exec();
    res.json(bill);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

const downloadPaymentReport = async (req, res, next) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));

  try {
    const bill = await Bill.find(
      { status: "paid" },
      "  bill_name bill_amount status createdAt"
    ).populate({
      path: "individual",
      select: "first_name last_name",
    });
    let billArray = bill.map((b) => ({
      Bill_Name: b.bill_name,
      Bill_Amount: b.bill_amount,
      Individual: `${b.individual.first_name} ${b.individual.last_name}`,
      Status: b.status,
      Mode_Of_Payment: b.mode_of_payment,
      Transaction_ref: b.transaction_ref,
      Date_Issued: b.createdAt,
    }));
    const headers = Object.keys(billArray[0]);
    const csvData = csv.stringify([
      headers,
      ...billArray.map((item) => Object.values(item)),
    ]);

    fs.writeFileSync("payment.csv", csvData);
    res.download("payment.csv");
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

const createEvent = async (req, res) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));

  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(400).json({ message: message });
  }
  const { name, members, venue, start_date, end_date, reminder } = req.body;
  const event = Event({
    name,
    members,
    venue,
    start_date,
    end_date,
    reminder,
  });
  try {
    await event.save();
    res.json(event);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

const getEvents = async (req, res) => {
  if (req.userData.role === "user")
    return next(HttpError("You are unauthorized for this operation", 403));
  try {
    const events = await Event.find({});
    res.json(events);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

module.exports = {
  getUsers,
  getUser,
  exportData,
  upload,
  createBills,
  usersBills,
  getBill,
  getExistingBill,
  getPaidBills,
  downloadPaymentReport,
  createEvent,
  getEvents,
};
