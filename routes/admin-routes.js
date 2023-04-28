const express = require("express");
const adminController = require("../controller/admin-controller");
const auth = require("../middleware/auth");
const { check } = require("express-validator");
const multer = require("multer");
const fileUpload = require("../middleware/file-upload");

const router = express.Router();

router.get("/getusers", auth, adminController.getUsers);
router.get("/user/:uid", adminController.getUser);

router.get("/export", auth, adminController.exportData);
router.post(
  "/upload",
  auth,
  function (req, res, next) {
    fileUpload(req, res, function (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          message:
            "Something went wrong, The field name should be upload and  Files should not be more than 5",
        });
      } else if (err) {
        return res.status(400).json({
          message: "Something went wrong, Please try again.",
        });
      }

      next();
    });
  },
  adminController.upload
);

router.post(
  "/create-bill",
  auth,
  [
    check("bill_name").not().isEmpty().withMessage("Bill name is required"),
    check("bill_amount").not().isEmpty().withMessage("Bill amount is required"),
  ],
  adminController.createBills
);
router.get("/users-bills", auth, adminController.usersBills);
router.get("/get-bill/:id", auth, adminController.getBill);

router.get("/existing-bills", auth, adminController.getExistingBill);
router.get("/paid-bills", auth, adminController.getPaidBills);
router.get("/download-report", auth, adminController.downloadPaymentReport);
router.post(
  "/add-event", auth,
  [
    check("name").not().isEmpty().withMessage("Name of event is required"),
    check("members")
      .not()
      .isEmpty()
      .withMessage("At least one member is required"),
    check("venue").not().isEmpty().withMessage("Venue is required"),

    check("start_date").not().isEmpty().withMessage("Start Date is required"),
    check("end_date").not().isEmpty().withMessage("End Date is required"),
  ],
  
  adminController.createEvent
);
router.get("/get-events", auth, adminController.getEvents);

exports.router = router;
